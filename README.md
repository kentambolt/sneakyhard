# Every Tile Once

Six simple games, one rule: use every tile exactly once. The levels are small, each has exactly one solution,
and they were found by a computer that searched millions of levels for the ones whose traps only show late.

The playable version lives in `docs/` and is served with GitHub Pages at [sneakyhard.com](https://sneakyhard.com).

## The games

| Game | Rules |
| --- | --- |
| **One Path** | One piece. Step tile by tile and visit every tile exactly once. |
| **Lockstep** | Two pieces, one control. Both move the same way; a piece that cannot move stays put. |
| **Black Ice** | Ice never disappears, but on ice you slide until you hit a tile (and land on it) or something you cannot step on. |
| **Crossroads** | Crossings never disappear, so you can cross them as often as you like. |
| **Checkpoints** | Numbered checkpoints must be taken in order; checkpoint 2 cannot be entered before you have stood on checkpoint 1. |
| **The Gauntlet** | Combinations of the elements above: two pieces, ice, crossings and checkpoints, at least two at a time. On a crossing a slide stops; when two pieces are in the same line, the front one moves first. |

On the board there is a single button: *Restart*, which turns green and moves on to the next level once the level
is solved. On phones the game fits on one screen and the rules sit behind the info icon. The phone's back button
first closes the info panel, then returns to the home page, and only then leaves the site.
Keyboard: arrow keys/WASD move, Z undoes, R restarts, N/Enter moves on after a solved level, H checks your route.

## Folders

| Folder | Contents |
| --- | --- |
| `docs/` | The public page (generated). No solutions and no difficulty numbers in the page. |
| `dev/` | The developer version: the same game, but pressing L twice shows the solution. The build scripts write levels here. |
| `tools/` | Solvers, generators, build scripts and tests (Node 18+, no dependencies). |
| `data/` | Candidate levels from the searches, so the pages can be rebuilt without searching again. |

Both pages are self-contained HTML files with no dependencies besides Google Fonts.
The engine (`tools/mix.js`) is embedded into the pages by `tools/build-public.js`.
"Check route" works out in the browser (with `solvableFrom` in the engine) whether the level can still be solved
from the current position, so the public page does not need to contain the solutions.

## Build the pages

```
npm run build          # all levels into dev/index.html, then docs/index.html
npm run build:public   # only docs/index.html from dev/index.html
```

## Find new levels

The generators run on all cores and merge the best candidates into `data/`:

```
node tools/gen.js exhaustive 5          # One Path: all 2^25 levels on 5x5
node tools/gen.js anneal 6 300          # One Path: simulated annealing for 300 s
node tools/gen-twins.js anneal 6 600    # Lockstep
node tools/gen-ice.js anneal 5 300      # Black Ice
node tools/gen-mix.js kryds 5 300       # Crossroads
node tools/gen-post.js 5 300            # Checkpoints
node tools/gen-mix.js mester 5 300 16 two,ice,num   # The Gauntlet: one combination of elements
npm run build
```

A Gauntlet combination is a comma-separated list of at least two of `two` (two pieces), `ice`, `perm` (crossings)
and `num` (checkpoints). Each combination is stored in its own file, `data/mester-<combo>_NxN.json`, and the build
first picks the best level of each combination, so the levels show different mixes.

`node tools/check.js 6` shows the analysis of the best One Path levels.

Level format: `#` tile, `.` hole, `~` ice, `+` crossing, `1`-`9` checkpoints, `S` start, `A`/`B` two pieces,
`a`/`b` a piece starting on a crossing.

## Tests

```
npm test            # quick cross-checks (about a minute)
npm run test:all    # also the big test of the shared engine (about 10 minutes)
```

| Game | Solver | Generator | Builder | Cross-check |
| --- | --- | --- | --- | --- |
| One Path | `solver.js` | `gen.js` | `build.js` | `test.js` |
| Lockstep | `twins.js` | `gen-twins.js` | `build-twins.js` | `test-twins.js` |
| Black Ice | `ice.js` | `gen-ice.js` | `build-ice.js` | `test-ice.js` |
| Crossroads, The Gauntlet, Checkpoints | `mix.js` | `gen-mix.js`, `gen-post.js` | `build-mix.js` | `test-mix.js`, `test-solvable.js` |

`mix.js` is a general engine (1-2 pieces, tiles, holes, ice, crossings, checkpoints) that covers all six games.
`test-mix.js` checks that it finds exactly the same number of solutions as the specialised solvers and an
independent, naive implementation. `test-solvable.js` checks the "Check route" function the same way.

## The difficulty measure

A "sensible player" never makes a move that visibly ruins the level right away: a tile that can no longer be
reached, several tiles that would all have to be the last one, or remaining tiles split up so the pieces cannot
reach them all. With lookahead `L` the player can also see that a move is dead if every continuation dies within
`L` moves. `P[L]` is the chance of solving the level on the first try when picking at random among the moves that
still look possible, and `bits[L] = -log2 P[L]`.

**score = sum of bits[L] for L = 0..8.** Deep traps count in many terms and therefore weigh the most.
Only levels with exactly one solution are kept. Game-specific requirements:

- **One Path:** up to 6 bonus points if "edges and corners first" (Warnsdorff) does not solve the level.
- **Lockstep:** both pieces must turn at least twice and cover at least a quarter of the tiles.
- **Black Ice, Crossroads, The Gauntlet:** a "move" is a press that uses new tiles; moving around on ice and
  crossings in between is free. Black Ice must slide on ice at least twice, Crossroads must end on a crossing at
  least twice. In The Gauntlet every element of the combination must matter: both pieces use at least a fifth of
  the tiles, the solution slides on ice and ends on a crossing, and without the numbers the level would not have
  a unique solution.
- **Checkpoints:** the checkpoints must matter: without the numbers the level must not have a unique solution.

When levels are picked for the game, levels that only differ by decoration, or whose solution is too similar to
an already picked level, are left out.
