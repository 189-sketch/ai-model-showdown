// Internal render resolution (scaled up with nearest-neighbour)
export const W = 480;
export const H = 270;
export const FPS = 60;
export const FRAME_MS = 1000 / FPS;

// World
export const STAGE_W = 720;
export const GROUND_Y = 238; // screen y of the floor line
export const WALL_PAD = 18;
export const MAX_SEP = W - 2 * WALL_PAD - 8;
export const BODY_HALF = 19;

// Rounds
export const ROUND_SECONDS = 60;
export const ROUNDS_TO_WIN = 2;
export const METER_STOCK = 1000;
export const METER_MAX = 2000;

// Input bits (absolute directions; the sim converts to forward/back)
export const IN_U = 1;
export const IN_D = 2;
export const IN_L = 4;
export const IN_R = 8;
export const IN_LP = 16;
export const IN_HP = 32;
export const IN_LK = 64;
export const IN_HK = 128;
export const BTN_MASK = IN_LP | IN_HP | IN_LK | IN_HK;
export const IN_P = IN_LP | IN_HP;
export const IN_K = IN_LK | IN_HK;
