// Stato condiviso dell'applicazione. Gli altri moduli importano questi valori (sola lettura) e li
// modificano solo tramite i setter qui sotto.
export let D = null;          // data.json
export let M = [];            // strumenti "core" (D.markets, ripuliti)
export const BYSYM = {};      // simbolo -> strumento core
export let db = null;         // capability db di claude.ai (solo dentro claude.ai)
export let sample = null;     // capability sample di claude.ai (solo dentro claude.ai)
export const setD = x => { D = x; };
export const setM = x => { M = x; };
export const setDb = x => { db = x; };
export const setSample = x => { sample = x; };
