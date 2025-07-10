require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@devconnect.2umbcvr.mongodb.net/?retryWrites=true&w=majority&appName=devConnect`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    console.log("MongoDB connected successfully");

    const database = client.db("devConnect");
    const postsCollection = database.collection("posts");
    const usersCollection = database.collection("users");

    // PUT /users - Store user if not exists
    app.put("/users", async (req, res) => {
      const { name, email, photoURL } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      try {
        const existingUser = await usersCollection.findOne({ email });

        if (existingUser) {
          return res.status(200).json({ message: "User already exists" });
        }

        const newUser = {
          name,
          email,
          photoURL,
          role: "user", // optional default role
          paymentStatus: "unpaid", // optional default payment status
          createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);
        res
          .status(201)
          .json({ message: "New user stored", insertedId: result.insertedId });
      } catch (error) {
        console.error("Error in /users:", error);
        res.status(500).json({ message: "Failed to store user" });
      }
    });

    // POST a new post
    app.post("/posts", async (req, res) => {
      try {
        const postData = req.body;
        const result = await postsCollection.insertOne(postData);
        res.status(201).json(result);
      } catch (error) {
        console.error("Error creating post:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);
app.get("/", (req, res) => {
  res.send("Hello Tonoy!.... Your server ready");
});

app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
