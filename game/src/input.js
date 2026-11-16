// Keyboard, mouse look and pointer lock. Keeps one edge-triggered queue so the sim can
// react to single presses (reload, grenade, buy, plant) without polling DOM events.
export function createInput(canvas, callbacks) {
  const state = {
    keys: new Set(),
    pressed: new Set(), // consumed by takePressed()
    lookX: 0,
    lookY: 0,
    firing: false,
    aiming: false,
    locked: false,
  };

  function onKey(e, down) {
    if (e.code === 'Tab') e.preventDefault();
    if (down) {
      if (!e.repeat) state.pressed.add(e.code);
      state.keys.add(e.code);
    } else {
      state.keys.delete(e.code);
    }
  }

  function onMouseMove(e) {
    if (!state.locked) return;
    state.lookX += e.movementX || 0;
    state.lookY += e.movementY || 0;
  }

  function onMouseDown(e) {
    if (!state.locked) return;
    if (e.button === 0) state.firing = true;
    if (e.button === 2) state.aiming = true;
  }

  function onMouseUp(e) {
    if (e.button === 0) state.firing = false;
    if (e.button === 2) state.aiming = false;
  }

  function onLockChange() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      state.firing = false;
      state.aiming = false;
    }
    callbacks.onLockChange(state.locked);
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  document.addEventListener('keydown', (e) => onKey(e, true));
  document.addEventListener('keyup', (e) => onKey(e, false));
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLockChange);
  canvas.addEventListener('contextmenu', onContextMenu);

  return {
    state,
    requestLock() {
      // Pointer lock needs a user gesture: a call from the buy timer expiry is
      // refused (NotAllowedError) and the pause overlay offers Resume instead.
      // The rejection must be swallowed, or it surfaces as an uncaught error.
      try {
        const p = canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        // Older browsers throw synchronously; the pause overlay is the fallback.
      }
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const look = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return look;
    },
    takePressed() {
      const out = state.pressed;
      state.pressed = new Set();
      return out;
    },
    clear() {
      state.keys.clear();
      state.pressed.clear();
      state.firing = false;
      state.aiming = false;
    },
  };
}
