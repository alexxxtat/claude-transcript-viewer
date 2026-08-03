# Security

## Threat model

This tool renders a `.jsonl` transcript into HTML. **A transcript is untrusted input.** You may
be handed one by someone else, and a viewer that trusted it would run their markup inside a page
that is displaying your own private conversation.

Everything else about the design reduces exposure rather than adding to it: no dependencies, no
network access, no server, and the page runs from `file://` with no origin to leak to.

## What has been found and fixed

**Attribute break-out through an embedded image (fixed).** Both halves of an embedded image's
`data:` URI come straight from the transcript. A `media_type` of `png" onerror="…` escaped the
`src` attribute and executed. Confirmed with headless Chrome, which reported
`<title>XSS-FIRED</title>`, then closed by whitelisting the media type, requiring the payload to
be real base64, and escaping the attribute anyway.

`demo/test_hardening.py` pins it. Four probes render in a real browser and the DOM is inspected
afterwards, because a static scan of the generated HTML cannot decide what a page does when it
runs. Removing the whitelist turns two of them red, which is how the test was itself verified.

```bash
python3 demo/test_hardening.py
```

## Reporting something

Open an issue. This is a local tool with no service behind it and no user data in anyone else's
hands, so there is nothing to embargo and a public report is fine. If you would rather not post a
working payload, describe the shape of it and I will reproduce.

A report is most useful with the smallest `.jsonl` that shows the behaviour.

## Out of scope

- Anything requiring you to already control the machine, since the tool only reads files you can
  read anyway.
- The contents of your own transcripts. Generated HTML holds the whole conversation including
  screenshots, on purpose. `.gitignore` excludes `claude-*.html` so it is not committed by
  accident, but where you put the file afterwards is your decision.
