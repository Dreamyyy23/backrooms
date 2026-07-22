# Foxyverse Backrooms

This is a browser game, not a Node.js program. From this folder, run:

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000/index.html>.

The first click arms the procedural environmental sound engine. Headphones are recommended. If a browser blocks Web Audio, click the receiver again; `CONTINUE SILENTLY` always leaves the game accessible, and sound can be armed later from the Fox Compass.

The persistent Fox Compass provides stable travel controls while the room prose and visual effects remain unreliable:

- `MAP` opens discovered cartography and the recent-threshold journal.
- `EXITS` moves directly to the room's directional route cards.
- `BACK` returns through the last logged threshold.
- Route cards always preserve destination, bearing, risk, and returnability.

Progress is kept in `sessionStorage` for the current browser tab. The ending's new-loop link explicitly clears the run while preserving the player's sound preference.
