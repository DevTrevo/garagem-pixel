"""Inlines pipeline.js and encoders.js into template.html and writes the single-file page."""
import pathlib, sys

here = pathlib.Path(__file__).parent
src = here / "src"
template = (src / "template.html").read_text(encoding="utf-8")
for marker, name in (("/*PIPELINE*/", "pipeline.js"), ("/*ENCODERS*/", "encoders.js"), ("/*RACHA*/", "racha.js"), ("/*SPRITE*/", "sprite.js"), ("/*EDITORUI*/", "editor_ui.js")):
    code = (src / name).read_text(encoding="utf-8")
    assert "</script>" not in code, name + " must not contain </script>"
    assert marker in template, marker + " placeholder missing"
    template = template.replace(marker, code)
dest = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else here / "dist" / "garagem-pixel.html"
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(template, encoding="utf-8")
print("wrote", dest, len(template), "bytes")
