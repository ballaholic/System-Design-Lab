At 3 a.m. the database stops responding. This stage's simulation takes down the database that receives the writes.

Look at what still works. Cached redirects don't need the database, so most redirects keep succeeding. Cache misses and new links do need it, so they fail.

Making writes survive needs a second copy of the data and a way to switch to it, which the simulator doesn't model. It says so instead of inventing a number. Decide how you'd handle it, and check that redirects keep working.
