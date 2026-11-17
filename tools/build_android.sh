#!/usr/bin/env bash
# Build the signed AAB for Google Play (一箭清空 / Arrow Clear).
#
#   STAGE=release ./tools/build_android.sh   # signed bundleRelease AAB
#   STAGE=debug   ./tools/build_android.sh   # CI dry run: assembleDebug
#
# Flow: Cocos Creator CLI generates the Gradle project from
# tools/build-config-android.json, gradle.properties gets target SDK / ABI /
# release signing keys, the manifest gets portrait locked, and versions are
# injected through AGP's android.injected.* properties (the Android Studio
# mechanism — no generated files need editing). Signing values come from
# release.env (git-ignored) locally or from secrets on CI:
#   KEYSTORE, KEYSTORE_PASS, KEYSTORE_USER (alias), KEY_PASS (defaults to KEYSTORE_PASS)
#
# Needs: Cocos Creator 3.8.6 (COCOS env or a known install path) and a JDK 17+
# with the Android SDK. Prefer the project's gradlew wrapper when present.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT/release.env" ]]; then
	# shellcheck disable=SC1091
	source "$ROOT/release.env"
fi
STAGE="${STAGE:-release}"
TARGET_SDK="${TARGET_SDK:-35}"
MIN_SDK="${MIN_SDK:-24}"
APP_ABI="${APP_ABI:-arm64-v8a}"
APP_NAME="${APP_NAME:-arrowclear}"
KEY_PASS="${KEY_PASS:-${KEYSTORE_PASS:-}}"

eval "$(python3 "$ROOT/tools/set_versions.py" get)"
BUILD_DIR="$ROOT/build/android"
PROJ_DIR="$BUILD_DIR/proj"
OUT_DIR="$ROOT/export/android"

find_cocos() {
	for candidate in \
		"${COCOS:-}" \
		"/Applications/Cocos/Creator/3.8.6/CocosCreator.app/Contents/MacOS/CocosCreator" \
		"$HOME/Applications/Cocos/Creator/3.8.6/CocosCreator.app/Contents/MacOS/CocosCreator" \
		"$HOME/cocos-creator/CocosCreator.app/Contents/MacOS/CocosCreator"; do
		[[ -n "$candidate" && -x "$candidate" ]] && { echo "$candidate"; return; }
	done
}

CC_BIN="$(find_cocos || true)"
if [[ -z "$CC_BIN" ]]; then
	echo "Cocos Creator 3.8.6 not found. Set COCOS=/path/to/CocosCreator binary." >&2
	exit 1
fi

echo "== resolve Android SDK/NDK for Cocos"
# The editor has no preferences on a fresh runner; build options carry the
# paths instead. Resolve the newest installed NDK and write a resolved copy
# of the build config into .tmp/ (gitignored — machine paths stay out of git).
ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
ANDROID_NDK="${ANDROID_NDK:-$(find "$ANDROID_SDK/ndk" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort -V | tail -1 || true)}"
if [[ ! -d "$ANDROID_SDK" ]]; then
	echo "Android SDK not found at $ANDROID_SDK (set ANDROID_HOME)" >&2
	exit 1
fi
if [[ -z "$ANDROID_NDK" ]]; then
	echo "No Android NDK under $ANDROID_SDK/ndk" >&2
	exit 1
fi
echo "sdk: $ANDROID_SDK"
echo "ndk: $ANDROID_NDK"
RESOLVED="$ROOT/.tmp/build-config-android.json"
mkdir -p "$ROOT/.tmp"
python3 - "$ROOT/tools/build-config-android.json" "$RESOLVED" \
	"$ANDROID_SDK" "$ANDROID_NDK" <<'PY'
import json, os, sys
src, dst, sdk, ndk = sys.argv[1:]
with open(src) as f:
    cfg = json.load(f)
android = cfg.setdefault('packages', {}).setdefault('android', {})
android['sdkPath'] = sdk
android['ndkPath'] = ndk
os.makedirs(os.path.dirname(dst), exist_ok=True)
with open(dst, 'w') as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
PY

echo "== Cocos CLI build -> Gradle project"
rm -rf "$BUILD_DIR"
# Exit code 36 is Cocos' documented CLI-build success; 32 invalid parameters,
# 34 build error. One line only: a newline inside --build silently no-ops.
set +e
"$CC_BIN" --project "$ROOT" --build "configPath=$RESOLVED"
rc=$?
set -e
if [[ $rc != 36 && $rc != 0 ]]; then
	echo "Cocos CLI build failed with exit code $rc (36=ok, 32=bad params, 34=build error)" >&2
	exit 1
fi
if [[ ! -d "$PROJ_DIR" ]]; then
	echo "No Gradle project at $PROJ_DIR" >&2
	exit 1
fi
echo "project: $PROJ_DIR"

GRADLE_PROPS="$PROJ_DIR/gradle.properties"
touch "$GRADLE_PROPS"
set_prop() {
	if grep -q "^$1=" "$GRADLE_PROPS"; then
		sed -i.bak "s/^$1=.*/$1=$2/" "$GRADLE_PROPS" && rm -f "$GRADLE_PROPS.bak"
	else
		printf '%s=%s\n' "$1" "$2" >> "$GRADLE_PROPS"
	fi
}

echo "== patch gradle.properties / manifest"
set_prop PROP_TARGET_SDK_VERSION "$TARGET_SDK"
set_prop PROP_MIN_SDK_VERSION "$MIN_SDK"
set_prop PROP_APP_ABI "$APP_ABI"

if [[ "$STAGE" == "release" ]]; then
	if [[ -z "${KEYSTORE:-}" || -z "${KEYSTORE_PASS:-}" || -z "${KEYSTORE_USER:-}" ]]; then
		echo "Signing not configured: set KEYSTORE / KEYSTORE_PASS / KEYSTORE_USER" >&2
		exit 1
	fi
	set_prop RELEASE_STORE_FILE "$KEYSTORE"
	set_prop RELEASE_STORE_PASSWORD "$KEYSTORE_PASS"
	set_prop RELEASE_KEY_ALIAS "$KEYSTORE_USER"
	set_prop RELEASE_KEY_PASSWORD "$KEY_PASS"
fi

MAIN_MANIFEST="$(find -L "$PROJ_DIR" -name 'AndroidManifest.xml' \
	-not -path '*build/outputs*' -print | head -1)"
if [[ -n "$MAIN_MANIFEST" ]]; then
	if grep -q 'android:screenOrientation=' "$MAIN_MANIFEST"; then
		sed -i.bak 's/android:screenOrientation="[^"]*"/android:screenOrientation="portrait"/' \
			"$MAIN_MANIFEST" && rm -f "$MAIN_MANIFEST.bak"
		echo "manifest: portrait locked ($MAIN_MANIFEST)"
	else
		echo "manifest: no screenOrientation attribute — check orientation ($MAIN_MANIFEST)"
	fi
else
	echo "manifest: no AndroidManifest.xml found under $PROJ_DIR" >&2
	exit 1
fi

GRADLE="$PROJ_DIR/gradlew"
if [[ ! -x "$GRADLE" ]]; then
	GRADLE="gradle"
	echo "no gradlew wrapper in $PROJ_DIR, using system gradle"
fi

echo "== gradle $STAGE build"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
if [[ "$STAGE" == "debug" ]]; then
	(cd "$PROJ_DIR" && "$GRADLE" assembleDebug --no-daemon)
	APK="$(find "$PROJ_DIR" -path '*build/outputs/apk/debug*' -name '*.apk' -print -quit)"
	if [[ -z "$APK" ]]; then
		echo "assembleDebug produced no APK" >&2
		exit 1
	fi
	cp "$APK" "$OUT_DIR/$APP_NAME-debug.apk"
	echo
	echo "Debug APK: $OUT_DIR/$APP_NAME-debug.apk (dry run OK, no signing attempted)"
	exit 0
fi

# AGP injected properties: versions and signing without editing generated
# files. Works for any AGP project — this is exactly what Android Studio does.
(cd "$PROJ_DIR" && "$GRADLE" bundleRelease --no-daemon \
	-Pandroid.injected.version.code="$BUILD" \
	-Pandroid.injected.version.name="$VERSION" \
	-Pandroid.injected.signing.store.file="$KEYSTORE" \
	-Pandroid.injected.signing.store.password="$KEYSTORE_PASS" \
	-Pandroid.injected.signing.key.alias="$KEYSTORE_USER" \
	-Pandroid.injected.signing.key.password="$KEY_PASS")

AAB="$(find "$PROJ_DIR" -path '*build/outputs/bundle/release*' -name '*.aab' -print -quit)"
if [[ -z "$AAB" ]]; then
	echo "bundleRelease produced no AAB" >&2
	exit 1
fi
cp "$AAB" "$OUT_DIR/$APP_NAME-release.aab"

echo "== verify versionCode"
AAPT2="$(find "${ANDROID_HOME:-$ANDROID_SDK_ROOT:-/nonexistent}" \
	-build-tools -name aapt2 -type f -print 2>/dev/null | sort -V | tail -1 || true)"
if [[ -n "$AAPT2" ]]; then
	CODE="$("$AAPT2" dump badging "$OUT_DIR/$APP_NAME-release.aab" 2>/dev/null \
		| head -1 | sed -n 's/.*versionCode=.\([0-9]*\).*/\1/p')"
	if [[ "$CODE" == "$BUILD" ]]; then
		echo "versionCode $CODE matches build $BUILD"
	else
		echo "versionCode mismatch: AAB says '$CODE', expected '$BUILD' \
(injected properties may be ignored by this template)" >&2
		exit 1
	fi
else
	echo "aapt2 not found; skipping versionCode check (play_upload will print it)"
fi

echo
echo "AAB: $OUT_DIR/$APP_NAME-release.aab (version $VERSION build $BUILD)"
