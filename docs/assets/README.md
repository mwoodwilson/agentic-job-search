# Workflow poster

`workflow-poster.png` is the picture at the top of the main README. It is made by `make-poster.py`, which also writes `workflow-poster.svg` (the source) and `workflow-poster.html` (a page to preview it).

To change the poster, edit `make-poster.py` and run it from the project folder:

```bash
python3 -I docs/assets/make-poster.py
```

The PNG is made by opening the page in Chrome without a window and taking a picture at twice the size. If Chrome is somewhere unusual, set `CHROME` to its path first. Add `--no-png` to skip the picture.

The README shows the PNG rather than the SVG because GitHub does not draw an SVG's fonts the way a Mac does. The poster uses only system fonts.

The test count on the poster is a number in `make-poster.py` (`TESTS`). Update it when `node --test` prints a different total.
