// Set in app.css, so the page layout can size the scene per breakpoint.
export const SCENE_HEIGHT = "var(--scene-height)";

/** The band of the camera's frame the device may ever fill, as fractions of
 *  its height from the top. At rest the device spans 0.151 to 0.927 of it;
 *  zoom is held inside the band, and the scene's layout box is exactly the
 *  band. So the box hugs the device: its top lines up with whatever starts
 *  beside it, and what follows it (the colour picker, the stem sliders) sits
 *  just under it. The canvas spills past the box at both ends. */
export const SCENE_CEILING = 0.145;
export const SCENE_FLOOR = 0.935;
