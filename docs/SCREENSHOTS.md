# Regenerating the screenshots

The images in the READMEs come from the fictional demo transcript, never from a real session.
To rebuild them after a UI change:

```bash
python3 demo/make_demo.py                                   # rebuild the demo transcript
python3 claude_transcript_viewer.py demo/sample-session.jsonl demo
python3 demo/shoot.py                                       # rebuild docs/screenshot-*.png
```

`shoot.py` drives headless Chrome. It injects a small script into a throwaway copy of the demo
HTML to open the media grid, expand a tool run, or switch language, so no manual clicking is
involved and the output is identical every run.

`screenshot-main-hant.png` and `screenshot-main-hans.png` are the heroes for the two translated
READMEs. They exist so those pages do not advertise 繁體中文 support with a picture of an English
interface. Only the chrome differs between the three shots: the conversation inside a transcript
is the reader's own text and is never translated.
