# Demo clip script

Target: **15–20 seconds**, silent, looping. Short enough to autoplay on X and
long enough to show the transcript doing real work.

The thing being sold is the transcript: one quiet rail of steps with the answer
where you're looking. That only reads if the clip shows a turn that *uses tools*
— a plain Q&A shows nothing the viewer hasn't seen elsewhere.

## Before recording

- **Window**: narrow the sidebar to ~420px and drag the editor pane to show a
  real file. The sidebar is the product; give it a third of the frame.
- **Theme**: Dark+ (default). The rail and dots were tuned against it.
- **Hide clutter**: close the terminal panel, hide breadcrumbs and minimap
  (`View → Appearance`), collapse other sidebars.
- **Zoom**: `Ctrl+=` twice. Text that reads on a phone is bigger than you think.
- **Start clean**: click the new-session icon so the transcript is empty.
- **Pre-warm**: run the exact prompt once beforehand. First runs pay CLI startup
  and model load; the clip should show the steady state.

## The beats

| Time | Action | What the viewer sees |
|---|---|---|
| 0:00–0:02 | Already typed in the composer, hit Enter | prompt goes up |
| 0:02–0:06 | *(don't touch anything)* | `● Pondering ⋯ · ~1.2K tokens` — dot pulsing, verb rotating |
| 0:06–0:11 | *(don't touch anything)* | tool steps appear on the rail: `Explored 8 items`, `Ran 3 commands`, each with ✓ ticks |
| 0:11–0:16 | *(don't touch anything)* | the answer streams in **below** the tool block, and the thinking line settles to `Thought for 12s · 58K tokens` |
| 0:16–0:19 | Click the thinking line once, then once more | trace expands, then collapses — shows it's there when you want it |

Stop the recording on the collapsed state so the loop returns to something calm.

## The prompt to use

Pick one that forces file reads and a structured answer:

```
read the main entry files and tell me what this project does in 5 bullets
```

Good because it: reads several files (tool steps), thinks visibly (token count
climbs), and produces a compact answer that fits the frame.

Avoid prompts that write files — permission cards interrupt the flow and add a
click the viewer has to interpret.

## Recording

- Windows: ShareX or the built-in Xbox Game Bar (`Win+G`) → record region.
- Export **GIF ≤ 5 MB** for the README (larger and GitHub degrades it), and
  **MP4** for X (better quality, autoplays, no size anxiety).
- 30fps is plenty; the only motion is text and a pulsing dot.

## Where each asset goes

- **README**: the GIF, directly under the one-line value prop, above the badges.
  A still screenshot below it for people who block images.
- **X**: the MP4. Video autoplays in-feed; GIFs get re-encoded badly.
- **Marketplace**: it renders the README, so the GIF carries over — but keep the
  static screenshots too, since the listing is often read on slow connections.
