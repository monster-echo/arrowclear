#!/usr/bin/env bash
# Build an App Store IPA for 一箭清空 (Arrow Clear).
#
#   STAGE=ipa  ./tools/build_ios.sh   # full: Cocos -> Xcode -> archive -> IPA
#   STAGE=sim  ./tools/build_ios.sh   # CI dry run: project + unsigned sim compile
#   STAGE=xcode ./tools/build_ios.sh  # stop after the Xcode project exists
#
# Flow: Cocos Creator CLI generates the Xcode project from
# tools/build-config-ios.json, Info.plist gets the encryption flag / display
# name / versions, archive uses automatic signing with the App Store Connect
# API key (same proven path as the tungtungtung pipeline), then -exportArchive
# re-signs as app-store-connect. Finally tools/ios/PrivacyInfo.xcprivacy is
# injected into the .app and the bundle is re-signed with the distribution
# identity — Cocos cannot add the privacy manifest to the Xcode project.
#
# Needs: Cocos Creator 3.8.6 (COCOS env or a known install path), Xcode, an
# Apple Distribution certificate for the team (locally in the keychain; on CI
# imported from secrets), and an ASC API key so Xcode can register the bundle
# ID and create the store profile via -allowProvisioningUpdates.
#
# A release.env next to the project (git-ignored) is sourced if present.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT/release.env" ]]; then
	# shellcheck disable=SC1091
	source "$ROOT/release.env"
fi
STAGE="${STAGE:-ipa}"
TEAM_ID="${TEAM_ID:-2VA9TC6SG4}"
BUNDLE_ID="${BUNDLE_ID:-tech.zhongbei.arrowclear}"
APP_NAME="${APP_NAME:-arrowclear}"
DISPLAY_NAME="${DISPLAY_NAME:-Arrow Clear}"
SIGNING_IDENTITY="${SIGNING_IDENTITY:-Apple Distribution: Zhenwei Ruan (2VA9TC6SG4)}"
ASC_KEY_PATH="${ASC_KEY_PATH:-/Users/echo/workspace/keys/AuthKey_3A864HP66K.p8}"
ASC_KEY_ID="${ASC_KEY_ID:-3A864HP66K}"
ASC_ISSUER="${ASC_ISSUER:-3c721bed-bf99-4f67-891f-5ae3b78bc7ac}"
PRIVACY="$ROOT/tools/ios/PrivacyInfo.xcprivacy"
# Cocos 3.8.6 defaults to iOS 12.0; modern Xcode (26+) refuses anything
# below 15.0. 15 also matches the tungtongtung baseline.
IOS_DEPLOYMENT_TARGET="${IOS_DEPLOYMENT_TARGET:-15.0}"
# New clang (Xcode 26+) hard-errors on patterns Cocos 3.8.6's vendored
# headers still use (enoki specializes std:: type traits, old enum
# conversions). Downgrade those diagnostics; real breakage still fails.
IOS_EXTRA_CXXFLAGS="${IOS_EXTRA_CXXFLAGS:-}"
if [[ -z "$IOS_EXTRA_CXXFLAGS" ]]; then
	IOS_EXTRA_CXXFLAGS='$(inherited) -Wno-error=invalid-specialization -Wno-error=enum-constexpr-conversion -Wno-error=deprecated-declarations -Wno-error=deprecated-non-prototype'
fi

eval "$(python3 "$ROOT/tools/set_versions.py" get)"
# set_versions.py prints lowercase; the workflow injects uppercase env.
# Accept either so the script works standalone and under CI.
VERSION="${VERSION:-$version}"
BUILD="${BUILD:-$build}"
BUILD_DIR="$ROOT/build/ios"
PROJ_DIR="$BUILD_DIR/proj"
ARCHIVE="$ROOT/export/ios/$APP_NAME.xcarchive"
EXPORT_DIR="$ROOT/export/ios/export"

# Find the editor binary locally or in the CI layout.
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

# Cocos 3.8.6 engine headers predate clang 17+, which made the argument-less
# `this->template fn()` form a hard error ("a template argument list is
# expected after a name prefixed by the template keyword"). Upstream fixed it
# in 3.8.7; patch the installed editor's copy in place. Idempotent: lines with
# explicit template args (fn<T>(...)) do not match the pattern.
patch_engine_headers() {
	local header
	header="$(dirname "$(dirname "$CC_BIN")")/Resources/resources/3d/engine/native/cocos/core/event/EventTarget.h"
	if [[ -f "$header" ]] && grep -q -- '->template addEventListener(' "$header"; then
		sed -i.bak 's/->template addEventListener(/->addEventListener(/g' "$header" \
			&& rm -f "$header.bak"
		echo "patched engine header for new clang: $header"
	fi
}
patch_engine_headers

# Same era problem: some vendored .a libraries have 64-bit mach-o members
# that are not 8-byte aligned; the new linker drops those members outright.
# Repack the misaligned ones in place (idempotent, marker-guarded).
EDITOR_RES="$(dirname "$(dirname "$CC_BIN")")/Resources/resources/3d/engine/native/external"
LIB_DIRS=()
for d in ios/libs ios-m1-simulator/libs mac/libs; do
	[[ -d "$EDITOR_RES/$d" ]] && LIB_DIRS+=("$EDITOR_RES/$d")
done
if [[ ${#LIB_DIRS[@]} -gt 0 ]]; then
	python3 "$ROOT/tools/repack_libs.py" "${LIB_DIRS[@]}"
fi
if [[ "$STAGE" != "xcode" && "$STAGE" != "sim" && ! -f "$ASC_KEY_PATH" ]]; then
	echo "App Store Connect key not found at: $ASC_KEY_PATH" >&2
	echo "Set ASC_KEY_PATH (and ASC_KEY_ID / ASC_ISSUER) and run again." >&2
	exit 1
fi

echo "== Cocos CLI build -> Xcode project"
rm -rf "$BUILD_DIR"
mkdir -p "$ROOT/.tmp"
RESOLVED="$ROOT/.tmp/build-config-ios.json"
python3 - "$ROOT/tools/build-config-ios.json" "$RESOLVED" "$ROOT" <<'PY'
import json, os, sys
src, dst, root = sys.argv[1:]
with open(src) as f:
    cfg = json.load(f)
splash = cfg.get('splashScreen', {}).get('logo', {})
if splash.get('image') and not os.path.isabs(splash['image']):
    splash['image'] = os.path.join(root, splash['image'])
os.makedirs(os.path.dirname(dst), exist_ok=True)
with open(dst, 'w') as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
PY
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
python3 "$ROOT/tools/apply_custom_splash.py"

# The real app project sits directly under proj/; CMake drops throwaway
# CompilerId*.xcodeproj probes deeper down — never pick those.
XCODEPROJ="$(find -L "$PROJ_DIR" -maxdepth 2 -name '*.xcodeproj' -not -path '*CMakeFiles*' -type d -print -quit)"
if [[ -z "$XCODEPROJ" ]]; then
	echo "No app .xcodeproj under $PROJ_DIR; candidates:" >&2
	find -L "$PROJ_DIR" -name '*.xcodeproj' -type d >&2
	exit 1
fi
echo "project: $XCODEPROJ"

SCHEME="$(xcodebuild -list -json -project "$XCODEPROJ" \
	| python3 -c 'import json,sys; print(json.load(sys.stdin)["project"]["schemes"][0])')"
echo "scheme: $SCHEME"

if [[ "$STAGE" == "xcode" ]]; then
	echo
	echo "STAGE=xcode: Xcode project ready at $PROJ_DIR (no compile attempted)."
	exit 0
fi

if [[ "$STAGE" == "sim" ]]; then
	echo "== unsigned simulator compile (CI dry run)"
	# Some 3.8.x versions had simulator-slice issues; if that hits, fall back to
	# an unsigned device build so the dry run still proves the project compiles.
	if ! xcodebuild -project "$XCODEPROJ" -scheme "$SCHEME" -configuration Release \
		-sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
		IPHONEOS_DEPLOYMENT_TARGET="$IOS_DEPLOYMENT_TARGET" \
		OTHER_CPLUSPLUSFLAGS="$IOS_EXTRA_CXXFLAGS" \
		CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
		PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" build; then
		echo "simulator compile failed; retrying as unsigned device build"
		xcodebuild -project "$XCODEPROJ" -scheme "$SCHEME" -configuration Release \
			-sdk iphoneos -destination 'generic/platform=iOS' \
			IPHONEOS_DEPLOYMENT_TARGET="$IOS_DEPLOYMENT_TARGET" \
			OTHER_CPLUSPLUSFLAGS="$IOS_EXTRA_CXXFLAGS" \
			CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
			PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" build
	fi
	echo
	echo "STAGE=sim: compile OK (no signing attempted)."
	exit 0
fi

# Cocos 3.8 iOS projects are CMake-generated: there is no physical app
# Info.plist in the project, it materialises inside the archive. Patch it
# there — -exportArchive re-signs with the distribution identity afterwards,
# so plist edits between archive and export are legitimate.

echo "== archive (automatic signing + ASC API key)"
SIGNING_ARGS=(
	DEVELOPMENT_TEAM="$TEAM_ID"
	PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID"
	MARKETING_VERSION="$VERSION"
	CURRENT_PROJECT_VERSION="$BUILD"
	IPHONEOS_DEPLOYMENT_TARGET="$IOS_DEPLOYMENT_TARGET"
	OTHER_CPLUSPLUSFLAGS="$IOS_EXTRA_CXXFLAGS"
	-allowProvisioningUpdates
	-authenticationKeyPath "$ASC_KEY_PATH"
	-authenticationKeyID "$ASC_KEY_ID"
	-authenticationKeyIssuerID "$ASC_ISSUER"
	CODE_SIGN_STYLE=Automatic
	CODE_SIGN_IDENTITY="Apple Development"
)
rm -rf "$ARCHIVE"
xcodebuild -project "$XCODEPROJ" -scheme "$SCHEME" \
	-configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
	-archivePath "$ARCHIVE" \
	"${SIGNING_ARGS[@]}" \
	archive

echo "== patch the archived Info.plist"
APP_DIR="$(find "$ARCHIVE/Products" -maxdepth 3 -name '*.app' -type d -print -quit)"
if [[ -z "$APP_DIR" ]]; then
	echo "No .app inside $ARCHIVE/Products" >&2
	exit 1
fi
INFO_PLIST="$APP_DIR/Info.plist"
pb_set() {
	/usr/libexec/PlistBuddy -c "Set :$1 $2" "$INFO_PLIST" 2>/dev/null \
		|| /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$INFO_PLIST"
}
pb_set ITSAppUsesNonExemptEncryption false
pb_set CFBundleDisplayName "$DISPLAY_NAME"
pb_set CFBundleShortVersionString "$VERSION"
pb_set CFBundleVersion "$BUILD"
# Portrait only, fullscreen: rewrite the orientation array wholesale.
/usr/libexec/PlistBuddy -c "Delete :UISupportedInterfaceOrientations" "$INFO_PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :UISupportedInterfaceOrientations array" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationPortrait" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Set :UIRequiresFullScreen true" "$INFO_PLIST" 2>/dev/null \
	|| /usr/libexec/PlistBuddy -c "Add :UIRequiresFullScreen bool true" "$INFO_PLIST"
echo "Info.plist: $INFO_PLIST"

echo "== export App Store IPA"
cat > "$ROOT/export/ios/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key><string>app-store-connect</string>
	<key>signingStyle</key><string>automatic</string>
	<key>teamID</key><string>$TEAM_ID</string>
	<key>destination</key><string>export</string>
	<key>uploadSymbols</key><false/>
	<key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST
rm -rf "$EXPORT_DIR"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$EXPORT_DIR" \
	-exportOptionsPlist "$ROOT/export/ios/ExportOptions.plist" \
	-allowProvisioningUpdates \
	-authenticationKeyPath "$ASC_KEY_PATH" \
	-authenticationKeyID "$ASC_KEY_ID" \
	-authenticationKeyIssuerID "$ASC_ISSUER"

IPA="$(find "$EXPORT_DIR" -name '*.ipa' -print -quit)"
if [[ -z "$IPA" ]]; then
	echo "Export produced no IPA" >&2
	exit 1
fi

echo "== inject PrivacyInfo.xcprivacy and re-sign"
# Cocos cannot carry the privacy manifest into the Xcode project, so it goes
# into the exported .app directly. Only the root bundle is modified; nested
# signatures stay valid. The distribution identity must be in a keychain the
# runner can use (CI imports it from secrets; locally it is in login).
STAGE_DIR="$ROOT/export/ios/ipa-stage"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
unzip -q "$IPA" -d "$STAGE_DIR"
APP_BUNDLE="$(find "$STAGE_DIR" -maxdepth 2 -name '*.app' -type d -print -quit)"
cp "$PRIVACY" "$APP_BUNDLE/PrivacyInfo.xcprivacy"
codesign --force --sign "$SIGNING_IDENTITY" \
	--preserve-metadata=entitlements,requirements,flags "$APP_BUNDLE"
codesign --verify --strict "$APP_BUNDLE"
# Verify the bundle id while the unpacked .app still exists.
IDENT="$(codesign -dvv "$APP_BUNDLE" 2>/dev/null | sed -n 's/^Identifier=//p')"
echo "bundle identifier: $IDENT"
if [[ "$IDENT" != "$BUNDLE_ID" ]]; then
	echo "Bundle id mismatch: built '$IDENT', expected '$BUNDLE_ID' \
(check packages.ios.packageName in tools/build-config-ios.json)" >&2
	exit 1
fi
rm -f "$IPA"
(
	cd "$STAGE_DIR"
	zip -qry "$IPA" Payload
)
rm -rf "$STAGE_DIR"
FINAL="$ROOT/export/ios/export/$APP_NAME.ipa"
mv "$IPA" "$FINAL"

echo
echo "IPA: $FINAL (version $VERSION build $BUILD)"
unzip -l "$FINAL" | grep -F 'PrivacyInfo.xcprivacy' >/dev/null \
	&& echo "privacy manifest: present"
