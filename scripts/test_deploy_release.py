import copy
import unittest
from deploy_release import validate


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


if __name__ == '__main__':
    unittest.main()
