# Face fixtures

These are photographs of four different people, all in the public domain. They serve only as technical test images and do not imply participation in or endorsement of Didit Events. They are the only photographs of real people in the repository, and the only exception to the rule in `CONTRIBUTING.md`.

| File | Subject and credit | License/source record |
| --- | --- | --- |
| `johnson.jpg` | Katherine Johnson, 1983; NASA | [US federal government work](https://commons.wikimedia.org/wiki/File:Katherine_Johnson_1983.jpg) |
| `tesla.jpg` | Nikola Tesla, circa 1890; Napoleon Sarony | [Public domain by age](https://commons.wikimedia.org/wiki/File:Tesla_circa_1890.jpeg) |
| `astronaut.jpg` | Eileen Collins; NASA | [scikit-image sample data and public-domain statement](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut) |
| `hopper.jpg` | Grace Hopper; James S. Davis, US Navy | [US Navy portrait record](https://commons.wikimedia.org/wiki/File:Grace_Hopper.jpg) |

The portraits were resized proportionally to at most 480 by 480 pixels, converted to RGB and encoded as optimized JPEG at quality 85. Their compressed sizes range from 27,566 to 46,732 bytes. `manifest.json` records the download URLs, original byte hashes, committed byte hashes, dimensions and credits. No image generation was used.

`multiple.jpg` places the Johnson and Tesla portraits side by side on a 640 by 400 canvas. It contains two real faces. `no-face.jpg` is a uniform gray 320 by 240 frame. Both are under 60 KB. The journey decodes every JPEG, checks its hash and checks the size limit on every run. Real sandbox face search uses `johnson.jpg`; deterministic fake searches recognize the committed bytes by hash.

The MIT license of the repository covers the code. These images keep their own status: public domain, as recorded above and in `manifest.json`.

Rules for a new fixture:

- A public-domain or openly licensed portrait, with its source URL, license and credit recorded in `manifest.json` and in the table above.
- Never a private person, a photograph you took, a politician or a celebrity.
- Prefer historical portraits or official government portraits published as public domain, like the four here.
