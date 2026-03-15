import sqlite3 from 'sqlite3';

const db=new sqlite3.Database("../backend/database/sales.db",(err)=>{
    if(err)
        console.log("database error : ",err);
    else
        console.log("databse connected");
})

export default db;