Signed store artifacts for Arrow Clear (一箭清空).

- `arrowclear-<version>+<build>.aab` — signed Google Play bundle (also uploaded to Play internal; production stays a draft until review).
- `arrowclear-<version>+<build>.ipa` — signed App Store IPA (also uploaded to TestFlight).

`.sha256` files let you verify downloads. This release is created automatically
by the `release` workflow on `v*` tags; publishing to the stores happens via
the `submit-review` workflow or the store consoles.
