export function addTransparentGenerationInstructions(prompt: string): string {
	return `${prompt}\n\nTransparent output handling: render the image on a flat solid green background using exactly #008000 everywhere that should become transparent. Do not use white, off-white, checkerboard, shadows, gradients, or texture in the background.`;
}
