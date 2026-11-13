#!/bin/sh
# Збирає Java-частину і запускає команду Main: package (пакети файлів мереж) або simulate (досліди).
set -e
cd "$(dirname "$0")"
JAVA_HOME_23="${JAVA_HOME_23:-/opt/homebrew/opt/openjdk}"
JAR="${PETRI_JAR:-../petri-paint/petri-swing-ui/target/petri-swing-ui.jar}"
rm -rf build && mkdir -p build
"$JAVA_HOME_23/bin/javac" -encoding UTF-8 -cp "$JAR" -d build java/lab6/*.java
"$JAVA_HOME_23/bin/java" -Djava.awt.headless=true -cp "build:$JAR" lab6.Main "$1" "$PWD"
