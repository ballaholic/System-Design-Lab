# What the simulator models

A deterministic, steady-state request-flow model. Each component has a capacity; traffic follows the connections and the flow steps defined on API servers and workers. Results are throughput and success rates per component and per operation.

## Assumptions

- A-STEADY-STATE (Steady state): Rates are sustained averages. Bursts, warm-up and transients aren't modeled.
- A-OVERLOAD-SHED (Overload is shed): Load above capacity is rejected immediately, not queued or retried.
- A-INDEPENDENT-FAILURE (Independent failures): Rejections at different components are independent and spread uniformly across requests.
- A-NO-SHORT-CIRCUIT (Every step is attempted): All steps of a flow are attempted even if an earlier step failed, so downstream load is an upper bound.
- A-HEALTH-CHECKS (Health checks): Distributors stop routing to components that are fully down. Partially degraded targets still receive an even share.
- A-EVEN-SPLIT (Even split): Distribution is even across capable targets. Queue consumption is proportional to consumer capacity.
- A-HIT-RATE-GIVEN (Hit rates are inputs): Cache and CDN hit rates are chosen by you or the challenge, not derived from data size or TTL.
- A-CACHE-ERROR-AS-MISS (Cache errors are misses): A rejected or failed cache lookup is treated as a miss, and the request continues to the store.
- A-POPULATE-BEST-EFFORT (Cache fills are best effort): Cache populate writes after a miss use only capacity left over by lookups and calls.
- A-NO-LATENCY (No latency): Latency isn't modeled. The engine reports throughput and success only.
- A-ILLUSTRATIVE-CAPACITY (Illustrative capacities): Default capacities are illustrative orders of magnitude, not benchmarks.

## Components

### Clients

- Capacity: Unlimited.
- Behaviour: Each client sends its share of every operation it sends (traffic share relative to the other clients sending it), split evenly across the connected components that can handle it.
- Success: Average success of the components it sends to. 0 if nothing can handle the operation (unroutable).
- Not modeled: Client retries; Think time and sessions.

### Load balancer and API gateway

- Capacity: Capacity in requests/s. A gateway's optional rate limit lowers it; those rejections are reported as rate-limited.
- Behaviour: Admits up to capacity, then splits each operation evenly across the targets that can handle it. Targets that are fully down are skipped (health checks).
- Success: Admission fraction × average success of its targets.
- Not modeled: Balancing algorithms other than an even split; Sticky sessions and connection limits; Authentication, request transformation and per-client limits.

### CDN

- Capacity: Capacity in requests/s.
- Behaviour: Admits up to capacity. For cacheable operations (all read operations unless you choose), the hit rate is served at the edge and misses are forwarded like a load balancer. Other operations are forwarded entirely.
- Success: Cacheable: admission × (hit rate + miss rate × target success). Other: admission × target success.
- Not modeled: TTLs and invalidation; Geographic distribution.

### API server

- Capacity: Healthy instances × capacity per instance, in requests/s.
- Behaviour: Admits up to capacity, then runs its flow for each operation on the admitted load. Every step is attempted, even after an earlier one failed, so downstream load is an upper bound.
- Success: Admission fraction × success of every required step.
- Not modeled: Autoscaling; Threads and connection pools; Warm-up.

### Background worker

- Capacity: Instances × throughput per instance, in messages/s. Reading from an event stream, it can't use more instances than the stream has partitions.
- Behaviour: Consumes messages from queues and streams and runs its flow for each message. Workers never reject: messages they can't consume stay in the backlog.
- Success: Success of every required step, for consumed messages. Shown as unknown when nothing is consumed.
- Not modeled: Retries and dead-letter queues; Poison messages; Ordering.

### Cache

- Capacity: Operations/s: lookups, calls and fills on miss.
- Behaviour: A cache lookup step hits at the configured hit rate; rejected lookups count as misses and run the on-miss steps. With populate on, every miss adds a best-effort fill that only uses leftover capacity.
- Success: Lookup step: effective hit rate + misses × on-miss success. A call to the cache: its admission fraction.
- Not modeled: Eviction and memory size; TTLs; Hit rate derived from data (it's an input).

### Databases and object storage

- Capacity: Separate read and write capacity.
- Behaviour: A call uses read or write capacity according to the step's setting or the operation's kind. Load above capacity is rejected.
- Success: Admission fraction of the resource used.
- Not modeled: Replication and failover; Locks and query cost; Storage size; Consistency.

### Message queue

- Capacity: Enqueue capacity in messages/s.
- Behaviour: Accepts published messages up to capacity. Consumers compete: each message goes to one worker, in proportion to worker capacity. Messages that aren't consumed add to the backlog.
- Success: A publish step succeeds when the queue accepts the message. Publishing isn't delivery.
- Not modeled: What happens once the queue is full; Visibility timeouts; Ordering.

### Event stream

- Capacity: Ingest capacity in messages/s.
- Behaviour: Accepts published messages up to capacity. Every consumer group (each connected worker) receives every message. Unread messages add to that group's lag.
- Success: A publish step succeeds when the stream accepts the message.
- Not modeled: Partition skew; Retention limits; Rebalancing; Exactly-once delivery.

## Failures that can be injected

- Primary down (sql-database, nosql-database, object-storage): The store stops serving reads and writes. Flows that call it fail; replicas don't take over.
- Cache down (redis-cache): Every lookup misses and every call to the cache fails, so reads fall through to the store.
- Instances fail (api-server): Some instances stop, reducing capacity. With no healthy instances left, distributors route around the server.
- Worker down (background-worker): The worker consumes nothing. Publishing still succeeds and the backlog grows.

## Never modeled

- Latency, percentiles and queueing delay.
- Replication, failover, sharding, consistency and partitions.
- Storage size, data transfer and cost.
