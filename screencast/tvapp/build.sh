#!/usr/bin/env bash
# Build APK không cần Gradle: aapt2 + javac + d8 + apksigner. Chạy trong Git Bash.
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-/d/dev/android-sdk}"
BT="$SDK/build-tools/34.0.0"
JAR="$SDK/platforms/android-34/android.jar"
OUT=build
rm -rf "$OUT" && mkdir -p "$OUT"/{gen,classes,dex}

python tools/gen_icons.py res/drawable
"$BT/aapt2.exe" compile --dir res -o "$OUT/res.zip"
"$BT/aapt2.exe" link -o "$OUT/unsigned.apk" -I "$JAR" --manifest AndroidManifest.xml \
  --min-sdk-version 21 --target-sdk-version 34 --version-code 1 --version-name 1.0 \
  --java "$OUT/gen" "$OUT/res.zip"

javac --release 8 -encoding UTF-8 -cp "$JAR" -d "$OUT/classes" $(find src "$OUT/gen" -name '*.java')
java -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --min-api 21 --lib "$JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')

cp "$OUT/unsigned.apk" "$OUT/with-dex.apk"
(cd "$OUT/dex" && jar uf ../with-dex.apk classes.dex)
"$BT/zipalign.exe" -f 4 "$OUT/with-dex.apk" "$OUT/aligned.apk"

[ -f debug.keystore ] || keytool -genkeypair -keystore debug.keystore -storepass android -keypass android \
  -alias debug -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=ScreenCast Debug"
java -jar "$BT/lib/apksigner.jar" sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android \
  --out screencast-tv.apk "$OUT/aligned.apk"
java -jar "$BT/lib/apksigner.jar" verify screencast-tv.apk && echo "BUILD OK -> $(pwd)/screencast-tv.apk"
