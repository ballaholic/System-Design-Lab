A celebrity shared one of your links. Traffic jumps to **11,000 requests per second**, still ten redirects for every new link.

Run the simulation at this load and look for red. More than one thing breaks: find each bottleneck and fix it the cheapest way.

Two tools help here. Stateless API servers can **scale out** by adding instances. And because most of the traffic is for the same few links, a **cache** in front of the database can answer most redirects without touching it.

The stage passes when nothing is saturated and at least 99% of requests succeed.
