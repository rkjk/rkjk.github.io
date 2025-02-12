---
layout: post
title:  "Debugging a DB Connection Pool Performance Issue"
date:   2025-02-12 22:53:46 +0530
categories: postgres,DB,Springboot
---
How many DB connections does a modern web connection need? This was the question I had in mind when facing a problem at work with timed out APIs due to a DB connection leak.  

## Problem Statement

At work, I was with the Credit Card Disputes Team. A customer would raise a dispute with the pertinent bank and this would make its way into our dispute service via and API which performed the necessary actions and persisted necessary entities. While this was a relatively heavy API (with several calls outbound to other services), I was only able to get a throughput of 5 disputes per second. Very low considering how fast modern computers are.  
  
The Dispute Service was a garden variety Springboot service which made it even weirder. Isn't Springboot supposed to be blazing fast with not much tweaking required?  


This was not a new issue and an engineer before me had attended to an incident where some requests were taking as long as 3 seconds to finish. The issue was determined to be due to the time taken to obtain connections from the pool, hence he had setup a small method that pre-warmed connections. In another separate incident, SRE had simpy had the connection pool size increased to handle a large load of parallel requests from the frontend. The Frontend's pattern of use was to raise multiple dispute creation requests at the same time. Inevitably, if the number of in-flight requests exceeded 5, some of them would time out. Since the request was idempotent, the frontend had a retry setup which would make the flow successful eventually. But the rate of failures was going up steaddily due to increasing traffic and this was flagged to our team.   
  

Looking at the logs, it was clear that the issue was the with the DB Connection Pool. The app was using JPA with HikariCP, a very common and oft-used combination known to be performant. To diagnose this, I brought up the service locally and hit it with requests in parallel, starting from 2 and then raising to 5. Beyond 5, one or more of the requests would freeze and eventually time out. HikariCP (the connection pool of choice for Springboot) would throw out these logs indicating a leak in the Connection Pool.  
  

As it turns out, both the minimum and maximum allowed connections for Hikari was set to 5, effectively fixing it at 5 connections. The default for Hikari is also 5, however the max allowed is usually set to 10 to account for request bursts. However this had been revised down because the Dispute service did not get anywhere near that amount of load. Most apps don't need greater than 10 or even fewer DB connections as most requests have a very small turnaround time and the CP reuses connections efficiently. Unless there is a specific query pattern with long-running queries or some such, the default is more than sufficient for most workloads.    
  
  
In anycase, I incremented the max connections to 10. This time, the parallel test worked upto 10 and then the subsequent request would time out. Same for any number of max connections. The app was only able to service as many concurrent requests as the number of threads in the DB Connection Pool!  
  
  
The time taken by the query was well-within expected values (mostly in microseconds upto a few millis for heavy write-ops), so the DB couldn't be the laggard here. Perhaps there was something wrong with the Connection Pool, maybe connections were being dropped or Hikari wasn't getting the response. I checked and re-checked the HikariCP settings and read the documentation to see if I was doing anything wrong but that didnt seem to be the case.  
  
  
The answer as it turns out wasn't in our code or even in the properties. It was spring setting not used by us - rather a spring default setting called Open-In-View (the setting is spring.jpa.open-in-view).  
  
## What is Spring Open In View  
  
This is a property of Springboot (which is set to true by default, so if you create a new Springboot project, your project now potentially has the same DB bottleneck) wherein every request to the Controller gets associated with a thread from the DB Connection pool. This allows you to make DB queries anywhere along the codepath of the request without worrying about a DB connection. Pretty neat right? Wrong! The lifetime of the connection is equal to the lifetime of the entire request. Say you have an API that reads some data from the DB and then performs some network operations (calling other microservices, performing some munging etc) and then performs a write. The Controller associates a DB connection to this request which is immediately used to fetch the data from the DB. Then, instead of returning this to the pool, the connection hangs around doing nothing while the request does the other non-DB operations. Then the DB connection is used for the final write and released to the pool once the Controller terminates the request. Even if there was no write at the end i.e the only DB operation was the read in the beginning, the DB connection is still kept on due to Open-In-View.  
  
Disabling this and running the same test, I started my test with 2, went to 5, then 10, then 20 all the way till 100 and the service kept chugging along nicely - no timeouts, no DB connection leaks. But this did mean having to make sure that there would be a DB connection present anytime a call to the DB is made.  
  
## Conclusion  
  
Debugging in Java Springboot is painful because, in many cases, it is not about the code you wrote (or someone else wrote), but about the settings and Annotations that are hiding beyond sight and silently modifying behaviour. In this case, a property default (although Springboot does issue a warning that this setting is not desired in the service logs) was the cause of the issue. Hopefully this post proves useful to someone debugging a similar issue or at least to the LLM overlords that are training on this.  
