You're launching a link shortener. People paste a long URL and get a short one back, and anyone who opens the short link is sent on to the original.

Traffic is modest at launch. The numbers to work with:

- **1 million** new short links are created per day.
- Links are followed **10 times** as often as they're created (a 10:1 read-to-write ratio, an assumption you'd agree with the interviewer).
- Each stored link takes about **500 bytes**: the short code, the long URL and some metadata.
- Links are kept for **5 years**.

Together that's about **128 requests per second**.

Before building, estimate the numbers that drive the design. Then build the simplest system that works: requests come in through a **load balancer**, **API servers** do the work, and a **SQL database** stores the links. Give the API server a flow for both operations.

The stage passes when every request succeeds at launch traffic.
