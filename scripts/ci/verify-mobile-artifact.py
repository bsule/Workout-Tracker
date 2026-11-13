"""Check fresh and cached archives, including the Rust/JNA libraries per APK ABI."""
import os
from pathlib import Path
from zipfile import ZipFile

platform = os.environ["BUILD_PLATFORM"]
extension = "ipa" if platform == "ios" else "apk"
artifacts = list(Path(f"target/mobile-artifacts/{platform}").glob(f"*.{extension}"))
if len(artifacts) != 1:
    raise RuntimeError(f"Expected one {extension}, got {artifacts}")
with ZipFile(artifacts[0]) as archive:
    if archive.testzip() is not None:
        raise RuntimeError("Corrupt archive")
    names = set(archive.namelist())
    if platform == "android":
        abis = set(os.environ["LIFT_ANDROID_ABIS"].split(","))
        packaged = {name.split("/")[1] for name in names if name.startswith("lib/") and name.endswith(".so")}
        if packaged != abis:
            raise RuntimeError(f"APK ABIs {packaged} differ from requested {abis}")
        for abi in abis:
            for library in ("liblift_native.so", "libjnidispatch.so"):
                if f"lib/{abi}/{library}" not in names:
                    raise RuntimeError(f"Missing {abi}/{library}")
    elif not any(name.startswith("Payload/") and name.endswith(".app/Info.plist") for name in names):
        raise RuntimeError("IPA has no application Info.plist")
print(f"Verified {artifacts[0]} ({artifacts[0].stat().st_size:,} bytes)")
