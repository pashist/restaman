# Restaman [![Dependency Status](https://david-dm.org/pashist/restaman.svg)](https://david-dm.org/pashist/restaman) [![npm](https://img.shields.io/npm/v/restaman.svg?maxAge=2592000)](https://www.npmjs.com/package/mongoose-patch-history-plugin)

Simple tool for expose mongoose model via REST api

### Requirements
- `node 5+`
- `mongoose 4+`
- `express`
- `body-parser`

### Basic usage example
Assumed you have mongoose `User` model registered.
```
const Restaman = require('restaman');
const restaman = new Restaman();

restaman.addModel('User');
app.use('/api', restaman.router());
```
Now express app will handle REST routes for `User` model on `/api/users` endpoint 

### Exposing methods
Restaman allows expose model static methods using `exposeStatic` method of ModelWrapper instance. 
```
const restaman = require('restaman');
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: String;
});

userSchema.statics.someMethod(function(param1, param2) {
    return {message: `${param1} ${param2}`};
});

mongoose.model('User', userSchema);
restaman.addModel('User').exposeStatic('someMethod');
app.use('/api', restaman.router());
```
It will a create routes for `User` model on `/api/users` endpoint including `POST /api/users/someMethod` route;
If we send POST request with data `{param2: 'oh!', param1: 'ah'}` to `/api/users/someMethod` it will return `{message: 'ah oh!'}`. 
**Note, params handled by it names so they order no matter.**

### Hooks
Restaman provide easy way to transform request and response by using `hooks`.
It includes `pre` and `post` types for `init`, `create`, `find`, `findOne`, `delete`, `update`, `count` actions.

##### Simple example for filtering docs by user:
```
const restaman = require('restaman');

const postSchema = new mongoose.Schema({
    title: String,
    user: {
        type: Number,
        ref: 'User'
    }
});

mongoose.model('Post', postSchema);

const filterOwner = function(req, res, query) => {
    query.filter.user = req.user.id;
}
restaman.addModel('Post').pre('find', filterOwner);
app.use('/api', restaman.router());
```
Now for `GET /api/users` request it will add `user` field to query filter: `Model.find({user: 123})`

##### Excluding some fields from result docs:
```

const hideEmail = function(req, res, docs) => {
    docs.forEach(doc => delete doc.email)
}
restaman.addModel('User').post('find', hideEmail);

```
**Note** that `find` and `findOne` is distinct actions and uses each own hooks.

##### Dynamic DB switching example using `pre` `init` hook
```
const restmean = require('restmean');
restmean.addModel('User').pre('init', (req, res, params) => params.db = req.params.db);
app.use('/api/:db', restmean.router({mergeParams: true}));
```
Now REST requests will instantiate model from specified in request database (using `useDb` method), eg `GET /api/test-db/users`

### Middleware
```
const requireAdmin = function(req, res, next){
    req.user.roles.indexOf('admin') === -1 ? res.sendStatus(401).end() : next();
}
restaman.addModel('Post').middleware(['create', 'update', 'delete'], requireAdmin);
```
More descriptions coming soon...

### Query
Affected actions: `find`, `findOne`, `count`.
Angular `$http` example:
```
$http.get('/api/posts', {
    params: {filter: {_id: 1}, projection: 'title', populate: 'user', limit: 3, skip: 5, sort: 'title'}
});
```
More descriptions coming soon...

### API docs
Coming soon...

### TODO
- Add more tests
- Expose instance methods
- 