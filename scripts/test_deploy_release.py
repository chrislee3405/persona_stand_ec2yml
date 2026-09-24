import copy
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from deploy_release import validate, validate_logging

REPOSITORY = Path(__file__).resolve().parents[1]


def receipt():
    images = {}
    for part, short, digit in [('frontend', 'front', 'a'), ('backend', 'back', 'b')]:
        digest = 'sha256:' + digit * 64
        images[part] = {'image': f'ghcr.io/example/persona_stand_{short}@{digest}',
                        'revision': digit * 40,
                        'ecrImage': f'123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/persona_stand/{part}@{digest}'}
    return {'schemaVersion': 1, 'status': 'promoted', 'images': images,
            'combinedTest': {'status': 'passed', 'selectedRelease': copy.deepcopy(images),
                            **{part + 'Image': value['image'] for part, value in images.items()}}}


class DeploymentValidation(unittest.TestCase):
    def test_exact_promoted_pair_produces_ecr_only_selection(self):
        values = validate(receipt())
        self.assertEqual(values, {'ECR_ACCOUNT_ID': '123456789012', 'AWS_REGION': 'ap-southeast-2',
                                 'FRONTEND_DIGEST': 'sha256:' + 'a' * 64, 'BACKEND_DIGEST': 'sha256:' + 'b' * 64})

    def test_reject_failed_test_or_unpromoted_receipt(self):
        for scope in ('combinedTest', None):
            data = receipt()
            (data[scope] if scope else data)['status'] = 'failed'
            with self.assertRaises(ValueError):
                validate(data)

    def test_reject_ghcr_moving_tags_or_other_repository_for_production(self):
        for value in ['ghcr.io/example/persona_stand_front@sha256:' + 'a' * 64,
                      '123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/persona_stand/frontend:main',
                      '123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/other/frontend@sha256:' + 'a' * 64]:
            data = receipt()
            data['images']['frontend']['ecrImage'] = value
            with self.assertRaises(ValueError):
                validate(data)

    def test_reject_changed_digest_source_or_registry(self):
        for key, old, new in [('ecrImage', 'sha256:a', 'sha256:c'),
                              ('revision', 'a', 'c'), ('ecrImage', '123456789012', '999999999999')]:
            data = receipt()
            data['images']['frontend'][key] = data['images']['frontend'][key].replace(old, new)
            with self.assertRaises(ValueError):
                validate(data)


def backend(environment):
    return {'services': {'backend': {'environment': environment}}}


class DeploymentLogging(unittest.TestCase):
    def test_production_levels_are_accepted(self):
        for level in ('INFO', 'info', 'WARNING', 'ERROR'):
            validate_logging(backend({'LOG_LEVEL': level, 'CHAT_TRACE': 'false'}))

    def test_debug_unset_or_typo_is_refused(self):
        for environment in ({'LOG_LEVEL': 'DEBUG'}, {'LOG_LEVEL': 'debug'}, {}, {'LOG_LEVEL': 'INFOO'}):
            with self.assertRaisesRegex(ValueError, 'LOG_LEVEL'):
                validate_logging(backend(environment))

    def test_chat_trace_is_refused(self):
        for value in ('true', 'TRUE', '1', 'yes', 'on'):
            with self.assertRaisesRegex(ValueError, 'CHAT_TRACE'):
                validate_logging(backend({'LOG_LEVEL': 'INFO', 'CHAT_TRACE': value}))

    @unittest.skipUnless(shutil.which('docker'), 'docker is needed to render docker-compose.ec2.yml')
    def test_committed_compose_file_passes_and_a_debug_env_file_fails(self):
        # The real file, rendered the way deploy() renders it on EC2.
        placeholders = {'ECR_ACCOUNT_ID': '000000000000', 'AWS_REGION': 'ap-southeast-2',
                        'FRONTEND_DIGEST': 'sha256:' + '0' * 64, 'BACKEND_DIGEST': 'sha256:' + '0' * 64}
        env = {key: value for key, value in os.environ.items() if key not in ('LOG_LEVEL', 'CHAT_TRACE', 'ENV')}
        env.update(placeholders)
        with tempfile.TemporaryDirectory() as directory:
            def render(env_file_text):
                env_file = Path(directory) / 'instance.env'
                env_file.write_text(env_file_text)
                return json.loads(subprocess.check_output(
                    ['docker', 'compose', '--env-file', str(env_file), '-f', str(REPOSITORY / 'docker-compose.ec2.yml'),
                     'config', '--format', 'json'], env=env, text=True, stderr=subprocess.DEVNULL))

            validate_logging(render(''))
            # A debugging session's leftover line in the instance's .env.
            with self.assertRaisesRegex(ValueError, 'LOG_LEVEL'):
                validate_logging(render('LOG_LEVEL=DEBUG\n'))


if __name__ == '__main__':
    unittest.main()
