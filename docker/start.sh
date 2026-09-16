#!/bin/sh
set -eu
mkdir -p /data/profiles /data/database /data/logs /data/screenshots
Xvfb :99 -screen 0 1440x1000x24 -nolisten tcp > /data/logs/xvfb.log 2>&1 &
sleep 1
x11vnc -display :99 -forever -shared -localhost -nopw > /data/logs/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc 6080 localhost:5900 > /data/logs/websockify.log 2>&1 &
exec node dist/index.js
