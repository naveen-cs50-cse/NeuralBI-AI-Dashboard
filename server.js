import dotenv from "dotenv";
dotenv.config();
import express from 'express';
import cors from 'cors';

const { default: routes } = await import('./routes/routes.js');

const app=express();
const port=2000;

app.use(cors(
    {
        origin :["http://127.0.0.1:5001",
    "http://127.0.0.1:5501",
    "http://127.0.0.1:5500",
    "http://localhost:3000",
    "https://mpghz63x-2000.inc1.devtunnels.ms",
    "https://focal-candidate-getting-fifteen.trycloudflare.com"
  ]
    }
));
 
app.use(express.json());
app.use(express.static("public"));

app.use("/api",routes)



app.listen(port,(err)=>
{
    if(err)
    {
        console.log('failed to start server ',err);
        process.exit(1);
    }
    else
        console.log('server started at port : 2000');
})