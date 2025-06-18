#!/usr/bin/env bash
curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-i686-static.tar.xz | tar xJ
mv ffmpeg-*/ffmpeg /usr/local/bin/
chmod +x /usr/local/bin/ffmpeg
