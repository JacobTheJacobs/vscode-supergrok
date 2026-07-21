# Launch post drafts

Drafts for **you** to edit and post. They are written in a plain voice on
purpose — the audiences below punish marketing register, and an extension with
no reviews yet has to sound like a person, not a campaign.

## Claims to keep honest

Two things will get corrected in the replies if you overstate them:

- **It is not a local model.** The *CLI* runs locally; it still calls xAI's API
  on your existing subscription. Say "drives your Grok CLI", never "local LLM"
  or "no cloud".
- **It is not official.** Not affiliated with xAI. The README already says this;
  keep it in the post too — it buys credibility rather than costing it.

The real pitch: *you already pay for Grok — this puts it next to your code,
without a second subscription.*

---

## X / Twitter

Clip-first. Post the MP4, keep the text short enough to read without expanding.

> Grok CLI now has a proper VS Code sidebar.
>
> Chat, file context, slash commands — driven by the CLI you already have
> installed, on the subscription you already pay for.
>
> Just shipped a transcript rework: thinking and tool steps collapse to one line
> each, so the answer stays where you're looking.
>
> Free, MIT, not affiliated with xAI.
> [marketplace link]

**Reply with a second post** (threading beats cramming):

> Why a sidebar and not a chat window: the CLI already knows your repo. The
> extension just stops you alt-tabbing to talk to it.
>
> Source: github.com/JacobTheJacobs/vscode-supergrok

Tag sparingly. Tagging every AI account reads as spam; one relevant account is
worth more than six.

---

## Reddit — r/vscode

Read the sub's self-promo rules first; several require a flair or limit
frequency. Lead with the problem, disclose authorship in the first line.

> **Title:** I built a VS Code sidebar for the Grok CLI (MIT, not affiliated with xAI)
>
> I use the Grok CLI daily and got tired of alt-tabbing to a terminal to ask it
> about code that was already open in front of me. So I wrote a sidebar that
> drives the CLI over stdio.
>
> What it does: chat with session history, slash commands, `@` file mentions,
> folder context, image paste, and permission prompts before it touches
> anything.
>
> The bit I just reworked: the transcript. Reasoning used to render as an
> expanded block on every turn and pushed the answer down the page. Now thinking
> and tool steps are single lines on a vertical rail, collapsed by default, with
> a live token count. Click any step to read the trace.
>
> Requirements: the Grok CLI installed and signed in. The extension is a face
> for it, not a replacement — no CLI, nothing to talk to.
>
> Source and install links below. Genuinely after feedback on the UX, especially
> from anyone using it on a large repo.

**Do not** cross-post the same text to r/LocalLLaMA. That sub is about local
models; this calls a hosted API and will be (fairly) downvoted for it.

---

## Dev.to / Hashnode

Long form. Lead with the design problem, not the feature list — that's what
makes it readable rather than an ad.

> **Title:** What a chat transcript should look like in an editor
>
> Opening: most AI sidebars show you everything the model did, in the order it
> did it, at equal weight. Reasoning traces, tool calls, and the actual answer
> all get the same visual treatment. The result is that the thing you asked for
> ends up somewhere in the middle of a wall of italics.
>
> Middle: what I changed and why — steps on a rail, collapsed by default, one
> dim line each; the answer always last. Include the before/after screenshots.
> The ordering bug is a good story: elements were appended in arrival order, so
> when a turn interleaved text → tools → text, the reply stayed in the *first*
> bubble and the tool block rendered after it.
>
> Close: what it is (a face for the Grok CLI), what it isn't (not official, not
> a local model), and the links.

---

## Order of operations

1. Record the clip (`docs/demo-script.md`) — everything else depends on it.
2. Publish a version so the README and changelog land on the listing.
3. X first (cheap, fast signal on whether the clip lands).
4. Reddit 2–3 days later, with the clip embedded, if the demo held up.
5. Dev.to last — it's the one worth linking back to from everywhere else.

Ask for feedback, not installs. "Tell me what's broken" gets replies; "please
install" gets scrolled past — and replies are what move a listing with no
reviews.
