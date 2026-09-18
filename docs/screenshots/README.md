# The README's screenshots and the tour GIF

Everything here is shot on a **scratch install with synthetic data**, never
on the owner's database. `jobs-list.png` and `tailor-resume.png` are the 1440×900 fold;
`tour.gif` is a 25-second screencast (1440×966, the caption band under the
page). Re-shoot both after a UI change that moves what they show.

## 1. A scratch instance

```bash
APPLYPACK_DATA_DIR=/tmp/ap-demo WEB_PORT=4949 APPLYPACK_NO_OPEN=1 npm start
```

Its own data folder, its own built-in database, port 4949. Stop it later
with the same variables and `npm run stop` — without `APPLYPACK_DATA_DIR`
the stop command looks at the default data folder.

## 2. Seed it

```bash
APPLYPACK_DATA_DIR=/tmp/ap-demo npx tsx docs/screenshots/demo-seed.ts
```

Thirteen fictional postings with fit scores and statuses (no AI call), one
running search ("Senior full-stack (TypeScript)", Lisbon, Europe, remote or
hybrid), the Claude Code CLI as the engine, the setup wizard marked done.
The install's default blank search must not stay primary: make the seeded
one primary on `/settings` → Profile and delete the blank one, or the jobs
page shows the "every running search is empty" banner.

## 3. The hero posting, for real

Five AI calls on whatever engine the scratch install can reach (the Claude
Code CLI here), through the app's own routes. `B=http://127.0.0.1:4949`;
the posting text is `jobText` in `site/public/demo/fixture.json`, the resume
is `demo-resume.md` (the demo's Dana Ruiz, a little longer).

```bash
curl -H "Origin: $B" --data-urlencode "companyName=Fernway" --data-urlencode "title=Senior Full-Stack Engineer (TypeScript)" \
  --data-urlencode "url=https://fernway.example.com/careers" --data-urlencode "location=Remote worldwide" \
  --data-urlencode "description@fernway.txt" "$B/jobs/new"                       # → /jobs/14, classified inline
curl -H "Origin: $B" -F "name=Dana Ruiz — full-stack" -F "file=@docs/screenshots/demo-resume.md;type=text/markdown" "$B/resumes"
curl -H "Origin: $B" --data-urlencode resumeId=1 --data-urlencode mode=full "$B/jobs/14/match"
curl -H "Origin: $B" --data-urlencode resumeId=1 --data-urlencode tone=warm --data-urlencode saveAngles=1 \
  --data-urlencode "whyCompany=Scheduling software for small clinics is the kind of unglamorous, useful product I like owning end to end." "$B/jobs/14/cover"
```

Each of the last three answers with a redirect to `/target/runs/<id>`;
`GET /target/runs/<id>/state` says `"stage":"done"` when it has finished.
Then set the hero to Alerted on its page so the list's top row reads like
the others.

## 4. Shoot

`record.js` drives a headless Chrome over the DevTools protocol (Node 22+,
no dependency). `BASE`, `JOB` and `MATCH` are environment variables
(defaults: port 4949, job 14, match 1).

```bash
node docs/screenshots/record.js shots docs/screenshots     # jobs-list.png, tailor-resume.png
node docs/screenshots/record.js gif /tmp/ap-frames         # the screencast, frames + timestamps
python3 docs/screenshots/build-gif.py /tmp/ap-frames /tmp/ap-seq 15   # 15 fps on the real timeline + caption band (Pillow)
ffmpeg -framerate 15 -i /tmp/ap-seq/%04d.png \
  -vf "split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  -loop 0 docs/screenshots/tour.gif
```

The scenes and their captions are the `caption(...)` calls in `record.js`.
The cursor and the click ripple are drawn into the page; the caption band is
drawn under each frame by `build-gif.py`, so nothing covers the UI.
`diff_mode=rectangle` and no dithering keep the GIF under 2 MB.
