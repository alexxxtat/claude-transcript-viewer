# Regenerating the screenshots

The images in the READMEs come from the fictional demo transcript, never from a real session.
To rebuild them after a UI change:

```bash
python3 demo/make_demo.py                                   # rebuild the demo transcript
python3 claude_transcript_viewer.py demo/sample-session.jsonl demo
python3 demo/shoot.py                                       # rebuild docs/screenshot-*.png
```

`shoot.py` drives headless Chrome. It injects a small script into a throwaway copy of the demo
HTML to open the media grid or expand a tool run, so no manual clicking is involved and the
output is identical every run.
