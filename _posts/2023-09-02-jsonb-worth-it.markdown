---
layout: post
title:  "JSONB with GIN: Worth it?"
date:   2023-09-02 20:01:46 +0530
categories: postgres,DB
---
Recently, a problem statement at work led me to the world of JSONB and indexes to speed up queries on JSONBs. 

## Problem Statement

Design a schema that would make it easy to query for a accountHolder by various different vectors or artifacts attached to that accountHolder. An artifact is any entity attached to an accountHolder - a prepaid account, a savings account, a phoneNumber, a wallet etc.  

At that point, there was no single service/DB that collated this information, so multiple API calls to many different microservices/DBs had to be made to get this information. Since this system was being redesigned, I thought it might be worthwhile to search for a better way to do this. My research made me land on JSONB and GIN Indexes for JSONB columns.  

## JSONB and GIN Index

For the uninitiated, postgres allows users to define a column's datatype as JSONB and has the ability to store JSONs, and more importantly query for the existence of keys and key-value pairs. The latter functionality is possible because Postgres allows you to define an index on a JSONB column as well. Called a Generalized Inverted Index or GIN Index, there are different *operator classes* defined by postgres. Postgres docs have a good explanation of the utility of these indices and more importantly which operator class makes sense for a query.  

Usually, JSONB queries are of the form "Does this key exist in the JSON?" or "Fetch the value for this key if it exists". For such queries, the default operator makes the most sense. In my case, the query was of the form "Fetch the JSON which has this Key-Value pair". Every accountHolder has a phoneNumber key and an account number key. The task is to fetch the accountHolder whose phoneNumber is xxxx, or whose accountNumber is yyyy. The *jsonb\_path\_ops* operator is more suited for this.   
```
# From postgres docs
CREATE INDEX idxgin ON api USING GIN (jdoc);  // default operator
CREATE INDEX idxginp ON api USING GIN (jdoc jsonb_path_ops);

// Consider sample JSON.
{
  "artifacts": [
    [
      {
	"accountNumber": "123",
	"planType": "prepaid",
	"cardNumber": "xxxx"
      },
      {
	"accountNumber": "456",
	"planType": "credit",
	"cardNumber": "yyyy"
      }
    ]
  ]
}

// Your task is to extract the accountNumber given the cardNumber. The query is as follows:
SELECT * FROM table_name WHERE jsonb_column @> '{artifacts:[[{"cardNumber": "yyyy"}]}'
```  
I benchmarked the performance of the jsonb\_path\_ops index on about 3GB of randomly generated data. Read queries are very fast although the writes do take a significant amount of time, at least on the measly 2020 Intel Mac provided at work. GIN indexes also take up a significant amount of extra space, although this is also a function of how deeply nested your JSONs are. The write performance issues are well known and covered in a post by pganalyze linked in the References section.

## Issues  
The issue with JSONB indices and JSONBs in general is the fact that it allows too much flexibility and the code incurs a lot of complexity in correctly parsing the JSON data into the right classes. The more deeply nested your JSON is, the more nested and complicated your service objects become.  

To be fair, this is not an issue with JSON or the GIN index itself. Rather, if the JSON being stored is not a document that will be used in its entirety, then program reading the JSON may need to parse the JSON and its constituent keys and values to their correct types.

For instance, if your JSON is as shown below:  
```
{
  "key1": [
    [
      {
        "nestedKey1": "nestedValue1"
      },
      {
        "nestedKey2": "nestedValue2"
      }
    ]
  ]
}
```  
Each layer potentially needs a custom serializer/deserializer to be written. This is the part I did not think of when designing this scheme, which eventually increased the complexity of the parsing code significantly.  

In my case, this (onetime) pain was well worth it, as was demonstrated by another (similar) problem of multiple entities pointing to a single entry. In that case, multiple tables were used to represent the same data with each table having separate B-Tree Indexes and a codebase that was so cryptic and complicated, it took a co-worker almost a week just to understand how the code was representing the entire data. After looking at my design, my co-worker remarked that they should have gone JSONB as the resulting code would have been much less complex and easier to read.

## Conclusion  
JSONB is a godsend, and along with GIN indexes, they are an amazing tool in the Postgres arsenal. The Indexes make the querying of very complex, deeply nested JSONs possible. However as the whole NoSQL vs SQL debate showed, more time must be spent looking at the problem being solved and whether the required business logic can be represented without making the use of JSON.  

## References:

1. [Postgres Docs on JSON Indexing](https://www.postgresql.org/docs/current/datatype-json.html#JSON-INDEXING).  
2. [Analysis of GIN Indexes](https://pganalyze.com/blog/gin-index)
