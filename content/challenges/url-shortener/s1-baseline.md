You're launching a link shortener. People paste a long URL and get a short one back, and anyone who opens the short link is sent on to the original.

Traffic is modest at launch: about **128 requests per second**, and links are followed ten times as often as they're created.

Before building, estimate the numbers that drive the design. Then build the simplest system that works: requests come in through a **load balancer**, **API servers** do the work, and a **SQL database** stores the links. Give the API server a flow for both operations.

The stage passes when every request succeeds at launch traffic.
