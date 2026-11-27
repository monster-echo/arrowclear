#!/usr/bin/env bash
# 跳过 Cocos CLI,直接对现有 Xcode 工程归档→导出→注入隐私清单→重签(修 iPad 图标后用)。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TEAM_ID="2VA9TC6SG4"
BUNDLE_ID="tech.zhongbei.arrowclear"
DISPLAY_NAME="一箭清空"
SIGNING_IDENTITY="Apple Distribution: Zhenwei Ruan (2VA9TC6SG4)"
ASC_KEY_PATH="/Users/echo/workspace/keys/AuthKey_3A864HP66K.p8"
ASC_KEY_ID="3A864HP66K"
ASC_ISSUER="3c721bed-bf99-4f67-891f-5ae3b78bc7ac"
PRIVACY="$ROOT/tools/ios/PrivacyInfo.xcprivacy"
IOS_DEPLOYMENT_TARGET="15.0"
IOS_EXTRA_CXXFLAGS='$(inherited) -Wno-error=invalid-specialization -Wno-error=enum-constexpr-conversion -Wno-error=deprecated-declarations -Wno-error=deprecated-non-prototype'
eval "$(python3 "$ROOT/tools/set_versions.py" get)"
VERSION="${VERSION:-$version}"
BUILD="${BUILD:-$build}"
XCODEPROJ="$ROOT/build/ios/proj/arrowclear.xcodeproj"
ARCHIVE="$ROOT/export/ios/arrowclear.xcarchive"
EXPORT_DIR="$ROOT/export/ios/export"

SCHEME="$(xcodebuild -list -json -project "$XCODEPROJ" | python3 -c 'import json,sys; print(json.load(sys.stdin)["project"]["schemes"][0])')"
echo "scheme: $SCHEME  version=$VERSION build=$BUILD"

echo "== archive"
rm -rf "$ARCHIVE"
xcodebuild -project "$XCODEPROJ" -scheme "$SCHEME" \
	-configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
	-archivePath "$ARCHIVE" \
	DEVELOPMENT_TEAM="$TEAM_ID" \
	PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
	MARKETING_VERSION="$VERSION" \
	CURRENT_PROJECT_VERSION="$BUILD" \
	IPHONEOS_DEPLOYMENT_TARGET="$IOS_DEPLOYMENT_TARGET" \
	OTHER_CPLUSPLUSFLAGS="$IOS_EXTRA_CXXFLAGS" \
	-allowProvisioningUpdates \
	-authenticationKeyPath "$ASC_KEY_PATH" \
	-authenticationKeyID "$ASC_KEY_ID" \
	-authenticationKeyIssuerID "$ASC_ISSUER" \
	CODE_SIGN_STYLE=Automatic \
	CODE_SIGN_IDENTITY="Apple Development" \
	archive

APP_DIR="$(find "$ARCHIVE/Products" -maxdepth 3 -name '*.app' -type d -print -quit)"
INFO_PLIST="$APP_DIR/Info.plist"
pb_set() { /usr/libexec/PlistBuddy -c "Set :$1 $2" "$INFO_PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$INFO_PLIST"; }
pb_set ITSAppUsesNonExemptEncryption false
pb_set CFBundleDisplayName "$DISPLAY_NAME"
pb_set CFBundleShortVersionString "$VERSION"
pb_set CFBundleVersion "$BUILD"
/usr/libexec/PlistBuddy -c "Delete :UISupportedInterfaceOrientations" "$INFO_PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :UISupportedInterfaceOrientations array" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationPortrait" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Set :UIRequiresFullScreen true" "$INFO_PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :UIRequiresFullScreen bool true" "$INFO_PLIST"
echo "Info.plist patched"

echo "== export"
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
STAGE_DIR="$ROOT/export/ios/ipa-stage"
rm -rf "$STAGE_DIR"; mkdir -p "$STAGE_DIR"
unzip -q "$IPA" -d "$STAGE_DIR"
APP_BUNDLE="$(find "$STAGE_DIR" -maxdepth 2 -name '*.app' -type d -print -quit)"
cp "$PRIVACY" "$APP_BUNDLE/PrivacyInfo.xcprivacy"
codesign --force --sign "$SIGNING_IDENTITY" \
	--preserve-metadata=entitlements,requirements,flags "$APP_BUNDLE"
codesign --verify --strict "$APP_BUNDLE"
echo "IPA ready: $EXPORT_DIR/arrowclear.ipa"
