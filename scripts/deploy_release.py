"""Deploy a downloaded promotion receipt; retain a receipt of running ECR digests.

Run from the ec2yml repository on EC2: python3 scripts/deploy_release.py promotion.json
The operator must download this file from a trusted successful promotion run.
"""
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def validate(promotion):
    if promotion.get('schemaVersion') != 1 or promotion.get('status') != 'promoted':
        raise ValueError('A successful promotion receipt is required')
    test = promotion['combinedTest']
    if test.get('status') != 'passed':
        raise ValueError('Combined tests did not pass')
    environment = {}
    for part in ('frontend', 'backend'):
        value = promotion['images'][part]
        match = re.fullmatch(r'(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com/persona_stand/' + part + r'@(sha256:[a-f0-9]{64})', value['ecrImage'])
        if not match:
            raise ValueError('Production requires an immutable ECR image reference')
        source = test['selectedRelease'][part]
        ghcr = re.fullmatch(r'ghcr\.io/[a-z0-9][a-z0-9-]*/persona_stand_' + ('front' if part == 'frontend' else 'back') + r'@(sha256:[a-f0-9]{64})', value['image'])
        if not ghcr or ghcr[1] != match[3] or source['image'] != value['image'] or source['revision'] != value['revision'] or test[part + 'Image'] != value['image'] or not re.fullmatch(r'[a-f0-9]{40}', value['revision']):
            raise ValueError('Source, tested GHCR image and promoted ECR image do not match')
        for key, content in [('ECR_ACCOUNT_ID', match[1]), ('AWS_REGION', match[2])]:
            if key in environment and environment[key] != content:
                raise ValueError('Both images must use the same ECR registry')
            environment[key] = content
        environment[part.upper() + '_DIGEST'] = match[3]
    return environment


# The log levels a production backend may run at. DEBUG -- and the backend's
# CHAT_TRACE switch -- write every visitor's messages to the container logs.
# The combined browser tests apply the same rule to the committed compose file
# (scripts/log-policy.mjs); this applies it to what will ACTUALLY run, .env
# overrides included. Keep the two in step.
SAFE_LOG_LEVELS = ('INFO', 'WARNING', 'ERROR')
_TRUE = ('1', 'true', 'yes', 'on')


def validate_logging(config):
    """Refuses a rendered compose configuration whose backend would log conversations."""
    environment = (config.get('services', {}).get('backend') or {}).get('environment') or {}
    level = str(environment.get('LOG_LEVEL', '')).strip().upper()
    if level not in SAFE_LOG_LEVELS:
        raise ValueError(
            'Refusing to deploy: backend LOG_LEVEL must be one of ' + ', '.join(SAFE_LOG_LEVELS)
            + ' (got ' + (level or 'unset') + '). Anything lower logs visitor conversations; '
            'check LOG_LEVEL in .env and docker-compose.ec2.yml.')
    if str(environment.get('CHAT_TRACE', '')).strip().lower() in _TRUE:
        raise ValueError('Refusing to deploy: CHAT_TRACE is on for the backend, which logs every conversation.')


def deploy(path):
    promotion = json.loads(Path(path).read_text())
    values = validate(promotion)
    env = {**os.environ, **values}
    compose = ['docker', 'compose', '--env-file', '.env', '-f', 'docker-compose.ec2.yml']
    # Checked against the configuration Compose will actually use, so a
    # LOG_LEVEL=DEBUG left in .env from a debugging session stops the
    # deploy here, before any container is replaced.
    validate_logging(json.loads(subprocess.check_output(compose + ['config', '--format', 'json'], env=env, text=True)))
    # Environment values override any stale image selection in .env.
    subprocess.run(compose + ['pull'], env=env, check=True)
    subprocess.run(compose + ['up', '-d', '--wait', '--wait-timeout', '180'], env=env, check=True)
    running = {}
    for part in ('frontend', 'backend'):
        container = subprocess.check_output(compose + ['ps', '-q', part], env=env, text=True).strip()
        details = json.loads(subprocess.check_output(['docker', 'inspect', container], text=True))[0]
        selected = promotion['images'][part]['ecrImage']
        image = json.loads(subprocess.check_output(['docker', 'image', 'inspect', details['Image']], text=True))[0]
        if details['Config']['Image'] != selected or selected not in image.get('RepoDigests', []):
            raise RuntimeError('Running container does not match the promoted digest')
        running[part] = {'containerId': details['Id'], 'imageId': details['Image'], 'ecrImage': selected}
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output = Path('deployment-records') / (timestamp + '.json')
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps({'deployedAt': timestamp, 'hostname': os.uname().nodename,
        'promotion': promotion, 'running': running}, indent=2) + '\n')
    Path('release-images.env').write_text(''.join(key + '=' + value + '\n' for key, value in values.items()))
    print('Deployment recorded in', output)
    print('Containers are running; perform the live application checks in Part C.')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 scripts/deploy_release.py promotion.json')
    deploy(sys.argv[1])
