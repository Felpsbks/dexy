#!/usr/bin/env bash
# Regenerates the synthetic motion sources used by runner.mjs's camera
# scenarios (fake --use-file-for-fake-video-capture input). Not committed as
# binary output -- run this once before `node runner.mjs camera`.
set -e
cd "$(dirname "$0")/media"
FONT="C\\:/Windows/Fonts/arial.ttf"

ffmpeg -y -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=10" \
  -vf "drawtext=fontfile='${FONT}':text='frame %{n} t=%{pts}':x=20:y=20:fontsize=48:fontcolor=white:box=1:boxcolor=black@0.6" \
  -pix_fmt yuv420p cam_720p30.y4m -loglevel error

ffmpeg -y -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=10" \
  -vf "drawtext=fontfile='${FONT}':text='frame %{n} t=%{pts}':x=20:y=20:fontsize=64:fontcolor=white:box=1:boxcolor=black@0.6" \
  -pix_fmt yuv420p cam_1080p30.y4m -loglevel error

ffmpeg -y -f lavfi -i "testsrc2=size=1920x1080:rate=60:duration=10" \
  -vf "drawtext=fontfile='${FONT}':text='frame %{n} t=%{pts}':x=20:y=20:fontsize=64:fontcolor=white:box=1:boxcolor=black@0.6" \
  -pix_fmt yuv420p cam_1080p60.y4m -loglevel error

echo "done"
