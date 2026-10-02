"""Wait for one shared release marker, then lock its tested components to digests."""
import json
import os
from pathlib import Path
import re
import subprocess
import time


def inspect_image(reference):
    result = subprocess.run(["skopeo", "inspect", "docker://" + reference],
                            text=True, capture_output=True, timeout=60)
    if result.returncode == 0:
        return json.loads(result.stdout)
    if any(code in result.stderr.lower() for code in ("manifest unknown", "name unknown")):
        return None
    raise RuntimeError("Registry lookup failed; refusing an older fallback: " + result.stderr)


def validate_image(info, image, version):
    labels = info.get("Labels") or {}
    revision = labels.get("org.opencontainers.image.revision", "")
    if (labels.get("org.opencontainers.image.version") != version
            or labels.get("org.opencontainers.image.source", "").lower() != "https://github.com/" + image.removeprefix("ghcr.io/")
            or not re.fullmatch(r"[a-f0-9]{40}", revision)
            or not re.fullmatch(r"sha256:[a-f0-9]{64}", info.get("Digest", ""))):
        raise RuntimeError("Image version/source/revision/digest mismatch for " + image)
    return {"image": image + "@" + info["Digest"], "revision": revision}


def resolve(version, owner, inspect=inspect_image, *, timeout=1800, interval=20,
            clock=time.monotonic, sleep=time.sleep):
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-rc\.[1-9][0-9]*)?", version):
        raise ValueError("RELEASE_VERSION must be X.Y.Z or X.Y.Z-rc.N")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", owner):
        raise ValueError("Invalid GitHub owner")
    deadline = clock() + timeout
    while True:
        pair = {"releaseVersion": version}
        missing = []
        for part, repository in (("frontend", "persona_stand_front"), ("backend", "persona_stand_back")):
            image = "ghcr.io/" + owner + "/" + repository
            info = inspect(image + ":release-" + version)
            if info is None:
                missing.append(part)
                continue
            selection = validate_image(info, image, version)
            # Resolve once more by immutable content, not the mutable tag path.
            pinned = inspect(selection["image"])
            if pinned is None or validate_image(pinned, image, version) != selection:
                raise RuntimeError("Published digest could not be verified for " + part)
            pair[part] = selection
        if not missing:
            return pair
        if clock() >= deadline:
            raise TimeoutError("Matching " + version + " images unavailable: " + ", ".join(missing)
                               + ". Check application CI, then rerun this workflow. No fallback selected.")
        print("Waiting for " + version + ": " + ", ".join(missing), flush=True)
        sleep(min(interval, max(0, deadline - clock())))


if __name__ == "__main__":
    version = Path("RELEASE_VERSION").read_text().strip()
    owner = os.environ["GITHUB_REPOSITORY"].split("/")[0].lower()
    pair = resolve(version, owner)
    # CI-only input to the existing validator; never edit or commit manual digests.
    Path("resolved-release.json").write_text(json.dumps(pair, indent=2) + "\n")
    print("Resolved matching release " + version + "; source revisions were read from image labels.")
