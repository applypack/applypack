# The README's screenshots and the tour GIF

Everything here is shot on a **scratch install with synthetic data**, never
on the owner's database. `overview-dashboard.png`, `jobs-ranked.png`,
`tailor-score.png` and `tailor-document.png` are the 1440×900 fold;
`applypack-tour.gif` is a 33-second screencast (1440×966, the caption band
under the page). Re-shoot them after a UI change that moves what they show,
and give a retaken file a new name: github.com serves README images through
a cache keyed by the URL, and a new file at an old path shows the old one
for hours.

## 1. A scratch instance

```bash
env -i PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin" HOME="$HOME" TMPDIR="$TMPDIR" \
  CLAUDE_CODE_OAUTH_TOKEN="…" TZ=Europe/Lisbon \
  APPLYPACK_DATA_DIR=/tmp/ap-demo WEB_PORT=4949 APPLYPACK_NO_OPEN=1 npm start
```

Its own data folder, its own built-in database, port 4949. `env -i` keeps
the shell's Telegram token and API keys out of it: the only secret it gets
is the Claude Code token the five AI calls below run on (a `claude` that is
logged in needs none). Stop it later with the same `APPLYPACK_DATA_DIR` and
`npm run stop` — without it the stop command looks at the default data
folder.

## 2. Seed it

```bash
APPLYPACK_DATA_DIR=/tmp/ap-demo npx tsx docs/screenshots/demo-seed.ts
```

Thirteen fictional postings with fit scores and statuses (no AI call), one
running search ("Senior full-stack (TypeScript)", Lisbon, Europe, remote or
hybrid) made primary with the install's blank one deleted, four months of
the search funnel and the latest runs for the Overview's chart and pipeline
health, the Claude Code CLI as the engine, the setup wizard marked done.
Every real source is switched off and fetching is on, so the worker's hourly
tick finds nothing to read and spends nothing.

## 3. The hero posting, for real

AI calls on whatever engine the scratch install can reach (the Claude Code
CLI here), through the app's own routes. `B=http://127.0.0.1:4949`; the
posting text is `jobText` in `site/public/demo/fixture.json`, the resume is
`demo-resume.docx` — the demo's Dana Ruiz (`demo-resume.md`) drawn by the
app's own clean renderer (`npx tsx docs/screenshots/demo-resume-docx.ts`),
so the Document view shows the user's own file with the edits in it.

```bash
curl -H "Origin: $B" --data-urlencode "companyName=Fernway" --data-urlencode "title=Senior Full-Stack Engineer (TypeScript)" \
  --data-urlencode "url=https://fernway.example.com/careers" --data-urlencode "location=Remote worldwide" \
  --data-urlencode "description@fernway.txt" "$B/jobs/new"                       # → /jobs/14, classified inline
curl -H "Origin: $B" -F "name=Dana Ruiz — full-stack" \
  -F "file=@docs/screenshots/demo-resume.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" "$B/resumes"
for job in 14 2 13; do                                                           # Fernway, a Node.js role, a PHP / Laravel one
  curl -H "Origin: $B" --data-urlencode resumeId=1 --data-urlencode mode=full "$B/jobs/$job/match"
done
curl -H "Origin: $B" --data-urlencode resumeId=1 --data-urlencode tone=warm --data-urlencode saveAngles=1 \
  --data-urlencode "whyCompany=Scheduling software for small clinics is the kind of unglamorous, useful product I like owning end to end." "$B/jobs/14/cover"
curl -H "Origin: $B" --data-urlencode status=ALERTED "$B/jobs/14/status"
```

Each upload, comparison and letter answers with a redirect to
`/target/runs/<id>`; `GET /target/runs/<id>/state` says `"stage":"done"`
when it has finished. On 2026-09-30 the three comparisons scored 85, 90
and 0 (the PHP posting: no core stack, a failed gate), and the whole set
took about three minutes.

## 4. Shoot

`record.js` drives a headless Chrome over the DevTools protocol (Node 22+,
no dependency). `BASE`, `JOB`, `MATCH` and `RESUME` are environment
variables (defaults: port 4949, job 14, match 1, resume 1).

```bash
node docs/screenshots/record.js shots docs/screenshots     # the four stills
node docs/screenshots/record.js gif /tmp/ap-frames         # the screencast, frames + timestamps
python3 docs/screenshots/build-gif.py /tmp/ap-frames /tmp/ap-seq 15   # 15 fps on the real timeline + caption band (Pillow)
ffmpeg -framerate 15 -i /tmp/ap-seq/%04d.png \
  -vf "split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  -loop 0 docs/screenshots/applypack-tour.gif
```

The scenes and their captions are the `caption(...)` calls in `record.js`:
the Overview, the jobs list, one posting's verdict, the comparison, **Apply
all suggestions** on Tailor resume (85 → 88), the Document view with the
changes marked, the letter, and the resume's Comparisons card (90, 85, 0).
The cursor and the click ripple are drawn into the page; the caption band
is drawn under each frame by `build-gif.py`, so nothing covers the UI.
`diff_mode=rectangle` and no dithering keep the GIF near 2 MB.

The site serves the same tour as a 25-second video, sped up by a quarter
from the same frames (`site/public/tour.webm` for the launch posts and the
landing's Tour section, `tour.mp4` for Safari, about 1 MB each), with its
first frame as the poster:

```bash
ffmpeg -framerate 20.134 -i /tmp/ap-seq/%04d.png -c:v libvpx-vp9 -crf 40 -b:v 0 \
  -row-mt 1 -deadline good -cpu-used 3 -pix_fmt yuv420p -an site/public/tour.webm
ffmpeg -framerate 20.134 -i /tmp/ap-seq/%04d.png -c:v libx264 -crf 28 -preset slow \
  -pix_fmt yuv420p -movflags +faststart -an site/public/tour.mp4
cwebp -q 80 /tmp/ap-seq/0000.png -o site/public/img/tour-poster.webp
```

The site's other images are crops of the stills; `site/README.md` lists the
commands.

## 5. Employer mode

`employer-*.png` (docs/employer-mode.md, and the `screening-*.webp` of the
site's `employers/` page) are one screening of the QA gold set on the same
instance: one call for the rubric, one per applicant, two for Compare with
AI.

```bash
G=src/screening/fixtures/gold/qa-automation
curl -H "Origin: $B" -d on=1 "$B/settings/employer-mode-toggle"
curl -H "Origin: $B" --data-urlencode jobMode=new --data-urlencode "title=Senior QA Automation Engineer (Playwright / TypeScript)" \
  --data-urlencode "companyName=Northwind Pay" --data-urlencode "location=Kyiv or remote within Ukraine" \
  --data-urlencode "description@$G/posting.txt" "$B/screen"                     # → /screen/1 once its run is done
curl -H "Origin: $B" $(for f in 01-olena-petrenko.md 02-marcus-ade-williams.txt 03-hanna-schmidt.md \
  04-ihor-bondar.txt 05-olena-petrenko-v2.md 06-injection.txt; do printf -- '-F files=@%s/resumes/%s ' "$G" "$f"; done) "$B/screen/1/applicants"
curl -H "Origin: $B" --data-urlencode ids=1,3,2 "$B/screen/1/compare/ai"      # when GET /screen/1/state has nothing queued
for d in 1:interview 3:interview 2:declined 4:declined 6:declined 5:hold; do
  curl -H "Origin: $B" --data-urlencode decision=${d#*:} "$B/screen/1/applicants/${d%%:*}/decision"
done
node docs/screenshots/record.js screening docs/screenshots   # SCREEN, APPLICANT, COMPARE override 1, 1, 1,3,2
```
