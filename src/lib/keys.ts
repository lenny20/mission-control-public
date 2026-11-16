// How shortcuts are written for this machine: ⌘ on a Mac, Ctrl elsewhere.

export const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
export const paletteKey = mod === '⌘' ? '⌘K' : 'Ctrl K';
