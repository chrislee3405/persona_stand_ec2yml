import unittest
import subprocess
from unittest.mock import patch
from resolve_release import resolve, inspect_image


def image(reference, version='1.0.3-rc.1'):
    repo = reference.split('@')[0].split(':')[0]
    return {'Digest': 'sha256:' + 'a' * 64, 'Labels': {
        'org.opencontainers.image.source': 'https://github.com/' + repo.removeprefix('ghcr.io/'),
        'org.opencontainers.image.revision': 'b' * 40,
        'org.opencontainers.image.version': version}}


class ResolveTests(unittest.TestCase):
    def test_both_matching_images_are_pinned(self):
        pair = resolve('1.0.3-rc.1', 'example', image)
        self.assertEqual(pair['releaseVersion'], '1.0.3-rc.1')
        self.assertTrue(all('@sha256:' in pair[p]['image'] for p in ['frontend', 'backend']))

    def test_waits_for_delayed_backend_without_using_an_older_tag(self):
        elapsed = [0]
        seen = []
        def inspect(ref):
            seen.append(ref)
            return None if '_back:' in ref and elapsed[0] == 0 else image(ref)
        def sleep(seconds):
            elapsed[0] += seconds
        pair = resolve('1.0.3-rc.1', 'example', inspect, interval=2, timeout=10, clock=lambda: elapsed[0], sleep=sleep)
        self.assertEqual(elapsed[0], 2)
        self.assertEqual(pair['backend']['revision'], 'b' * 40)
        self.assertTrue(all('@sha256:' in r or ':release-1.0.3-rc.1' in r for r in seen))

    def test_missing_images_time_out_without_fallback(self):
        with self.assertRaisesRegex(TimeoutError, 'No fallback'):
            resolve('1.0.3-rc.1', 'example', lambda r: None, timeout=0)

    def test_wrong_labels_and_invalid_digest_fail_immediately(self):
        for field in ['org.opencontainers.image.version', 'org.opencontainers.image.source', 'org.opencontainers.image.revision', 'Digest']:
            def inspect(ref):
                result = image(ref)
                if field == 'Digest': result[field] = 'invalid'
                else: result['Labels'][field] = 'wrong'
                return result
            with self.assertRaisesRegex(RuntimeError, 'mismatch'):
                resolve('1.0.3-rc.1', 'example', inspect)

    def test_missing_pinned_digest_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'digest could not'):
            resolve('1.0.3-rc.1', 'example', lambda r: None if '@' in r else image(r))

    def test_registry_permission_or_network_failure_is_not_absence(self):
        for detail in ['unauthorized', 'connection timeout']:
            with patch('resolve_release.subprocess.run', return_value=subprocess.CompletedProcess([], 1, '', detail)):
                with self.assertRaisesRegex(RuntimeError, 'Registry lookup failed'):
                    inspect_image('ghcr.io/example/image:tag')
        with patch('resolve_release.subprocess.run', return_value=subprocess.CompletedProcess([], 1, '', 'manifest unknown')):
            self.assertIsNone(inspect_image('ghcr.io/example/image:tag'))

    def test_invalid_inputs_are_rejected_before_registry_access(self):
        for version, owner in [('latest', 'example'), ('1.0.3', 'bad/owner')]:
            with self.assertRaises(ValueError):
                resolve(version, owner, lambda r: self.fail('must not inspect'))

if __name__ == '__main__':
    unittest.main()
