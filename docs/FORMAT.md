# The Claude Code transcript format

Reverse-engineered while building this viewer. Everything here was verified against real
session files on disk, not from documentation.

Things that are not obvious until you parse one:

**Injected content looks like you.** Skill and system payloads are stored as `type: "user"` records.
They carry `isMeta: true`, while genuine prompts carry `promptSource` / `origin` instead. Miss this
and a 156,000-character skill manual renders as something you typed. They're shown here as collapsed
grey blocks, labelled.

**Reasoning is not saved.** `thinking` blocks exist, thousands of them, but the `thinking` field is
an empty string. Only a cryptographic `signature` is stored. Across 25 sessions checked, zero had
text. The rendering path is implemented and the filter row appears automatically if that ever
changes, but today there is nothing to show.

**Images are stored two ways.** Most are base64-embedded in the record, which is why sessions with
screenshots run 14–18 MB. Some are path references to files elsewhere on disk. The CLI reads and
embeds those. The browser cannot reach them, so the drop path shows only the embedded ones.

**Tool results live in the next record.** A `tool_use` block in an assistant record is paired with a
`tool_result` block in a following user record via `tool_use_id`, so rendering needs two passes.

**Subagents are logged separately, at two different depths.** A `Task` run writes to
`<session>/subagents/agent-*.jsonl`, and an agent spawned by a workflow writes two directories
deeper, to `<session>/subagents/workflows/<wf_id>/agent-*.jsonl`. A glob that only covers the
shallow case silently finds a fraction of them: on the machine this was built on, 220 of 581.

**Most of the file is not conversation.** A session is largely `mode`, `bridge-session`,
`attachment` and `file-history` records. Dropping everything that isn't a `user` or `assistant`
message removed 986 of 2,534 lines from the session used to test this.

**Transcripts are deleted after 30 days** by default, governed by `cleanupPeriodDays` in
`~/.claude/settings.json`. Raise it before you rely on this for anything historical.
