'use strict';

const mongoose = require('mongoose');
const assert = require('assert');
const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');

const Restaman = require('..');
const ModelWrapper = require('..').ModelWrapper;

describe('Restaman', function () {

    before(done => {

        mongoose.connect('localhost/restaman-test-db', () => {
            const testSchema = new mongoose.Schema(
                {_id: Number, name: String, object: {someProp: String}},
                {versionKey: false}
            );
            testSchema.statics.exposedStaticMethod = function (param1, param2) {
                return {message: `exposedStaticMethod invoked with: param1: '${param1}', param2: '${param2}'`};
            };
            testSchema.statics.exposedStaticMethod2 = function (param1, param2) {
                return {message: `exposedStaticMethod2 invoked with: param1: '${param1}', param2: '${param2}'`};
            };
            const postSchema = new mongoose.Schema(
                {_id: Number, title: String, content: String, user: Number, field1: String, field2: String},
                {versionKey: false}
            );

            mongoose.model('Post', postSchema);
            mongoose.model('Test', testSchema);
            mongoose.model('Test').remove()
                .then(() => mongoose.model('Post').remove())
                .then(() => done()).catch(done);
        });

    });

    describe('Adding model', function () {
        it('should return ModelWrapper instance', () => {
            const restaman = new Restaman();
            restaman.removeModel('Test');
            let modelWrapper = restaman.addModel('Test');
            assert.equal(modelWrapper instanceof ModelWrapper, true);
        });
    });

    describe('Exposing static method', function () {
        const restaman = new Restaman();
        let modelWrapper = restaman.addModel('Test');

        it('should done without errors when method exists in model statics', () => {
            modelWrapper.exposeStatic('exposedStaticMethod');
        });
        it('should produce error when method exists in model statics', done => {
            try {
                modelWrapper.exposeStatic('wrongStaticMethod');
                done('Error not produced!');
            } catch (err) {
                done();
            }
        });
        it('should add method to statics list', () => {
            modelWrapper.exposeStatic('exposedStaticMethod');
            let statics = modelWrapper.getStatics();
            assert.deepEqual(statics, [{name: 'exposedStaticMethod', exposeName: 'exposedStaticMethod'}])
        });
        it('should replace method with same exposeName', () => {
            modelWrapper.exposeStatic('exposedStaticMethod');
            modelWrapper.exposeStatic({name: 'exposedStaticMethod2', exposeName: 'exposedStaticMethod'});
            let statics = modelWrapper.getStatics();
            assert.deepEqual(statics, [{name: 'exposedStaticMethod2', exposeName: 'exposedStaticMethod'}])
        });
    });

    describe('Base routes', function () {

        const app = express();
        const restaman = new Restaman();
        let server;

        before(done => {
            restaman.addModel('Test').exposeStatic('exposedStaticMethod');
            let router = restaman.router();
            app.use(bodyParser.json());
            app.use('/api', router);
            app.get('/', (req, res) => {
                res.cookie('cookie', 'hey');
                res.send({message: 'OK!!!'})
            });
            app.post('/', (req, res) => res.send(req.body));
            server = app.listen(3003, () => {
                done();
            });
        });

        after(done => server.close(done));


        it('GET /', done => request(app).get('/')
            .expect('set-cookie', 'cookie=hey; Path=/')
            .expect(200, {message: 'OK!!!'}, done));

        it('POST /', done => request(app).post('/').send({msg: 'hello'}).expect(200, {msg: 'hello'}, done));

        it(`POST /api/tests "{name: 'someName', _id: 1}"`, done => {
            request(app)
                .post('/api/tests')
                .send({name: 'someName', _id: 1})
                .expect(200, {name: 'someName', _id: 1}, done)
        });
        it(`POST /api/tests "{name: 'someName2', _id: 2}"`, done => {
            request(app)
                .post('/api/tests')
                .send({name: 'someName2', _id: 2})
                .expect(200, {name: 'someName2', _id: 2}, done)
        });
        it('GET /api/tests', done => {
            request(app)
                .get('/api/tests')
                .expect(200, [{name: 'someName', _id: 1}, {name: 'someName2', _id: 2}], done)
        });

        it('GET /api/tests/1', done => {
            request(app)
                .get('/api/tests/1')
                .expect(200, {name: 'someName', _id: 1}, done)
        });

        it(`POST /api/tests/1 "{name: 'newName', _id: 1}"`, done => {
            request(app)
                .post('/api/tests/1')
                .send({name: 'newName', _id: 1})
                .expect(200, {name: 'newName', _id: 1})
                .end(() => {
                    request(app).get('/api/tests').expect(200, [{name: 'newName', _id: 1}, {
                        _id: 2,
                        name: 'someName2'
                    }], done)
                });
        });

        it(`GET /api/tests/count`, done => {
            request(app)
                .get('/api/tests/count')
                .expect(200, {count: 2}, done)
        });

        it(`GET /api/tests/count?_id=2`, done => {
            request(app)
                .get('/api/tests/count')
                .query({_id: 2 })
                .expect(200, {count: 1}, done)
        });

        it(`DELETE /api/tests/1`, done => {
            request(app)
                .delete('/api/tests/1')
                .expect(200, {name: 'newName', _id: 1})
                .end(() => {
                    request(app).get('/api/tests').expect(200, [{_id: 2, name: 'someName2'}], done)
                });
        });

        it(`POST /api/tests/exposedStaticMethod`, done => {
            request(app)
                .post('/api/tests/exposedStaticMethod')
                .send({param2: 'param2 value', param1: 'param1 value'})
                .expect(200, {message: `exposedStaticMethod invoked with: param1: 'param1 value', param2: 'param2 value'`}, done);

        });

        it(`OPTIONS /api/tests`, done => {
            request(app)
                .options('/api/tests')
                .expect('Allow', 'GET, OPTIONS, DELETE, POST, PUT')
                .expect(204, {}, done);

        });

    });

    describe('Hooks', function () {

        const app = express();
        const restaman = new Restaman();
        let server;

        before(done => {
            const filterUser = (req, res, query) => query.filter.user = 1;
            const addContent = (req, res) => req.body.content = 'from pre create hook';
            const updateContent = (req, res, doc) => doc.content = 'from pre update hook';
            const restrictDelete = () => {
                throw new Error('Oops!')
            };
            const restrictCount = function (req, res, next) {
                res.status(401).send({message: 'count op not allowed for you!'});
            };
            const addFindOneContent = (req, res, doc) => {
                if(req.header('TEST-POST-FINDONE-HOOK')) {
                    doc.content = 'from post findOne hook';
                }
            };
            const addGetContent = (req, res, doc) => {
                if(req.header('TEST-POST-GET-HOOK')) {
                    doc.content = 'from post get hook';
                }
            };
            const addMultipleHooks = (req, res, doc) => {
                if(req.header('TEST-POST-MULTIPLE-HOOKS')) {
                    if(doc instanceof Array) {
                        doc.forEach(_doc => _doc.content = 'from post multiple hooks');
                    } else {
                        doc.content = 'from post multiple hooks';
                    }

                }
            };
            restaman.addModel('Test')
                .exposeStatic('exposedStaticMethod');
            let _post = restaman.addModel('Post')
                .pre('create', addContent)
                .pre('update', updateContent)
                .pre('find', filterUser)
                .pre('delete', restrictDelete)
                .post('findOne', addFindOneContent)
                .post('get', addGetContent)
                .post(['get', 'query'], addMultipleHooks)
                .middleware('count', restrictCount)
                .hide(['field1', 'field2']);

            let router = restaman.router();

            app.use(bodyParser.json());
            app.use('/api', router);

            /* error handler */
            app.use(function (err, req, res, next) {
                res.status(err.statusCode || 400).send({message: err.message}).end();
            });

            server = app.listen(3003, done);
        });

        after(done => server.close(done));

        it(`Add test Post "{title: 'some title', user: 1, _id: 1}"`, done => {
            request(app)
                .post('/api/posts')
                .send({title: 'some title', user: 1, _id: 1})
                .expect(200, {title: 'some title', user: 1, _id: 1, content: 'from pre create hook'}, done);
        });
        it(`Add test Post "{title: 'other title', user: 2, _id: 2}"`, done => {
            request(app)
                .post('/api/posts')
                .send({title: 'some title', user: 2, _id: 2, field1: '111'})
                .expect(200, {title: 'some title', user: 2, _id: 2, content: 'from pre create hook'}, done);
        });
        it(`pre create hook`, done => {
            request(app)
                .get('/api/posts/1')
                .expect(200, {title: 'some title', user: 1, _id: 1, content: 'from pre create hook'}, done);
        });
        it(`pre update hook`, done => {
            request(app)
                .post('/api/posts/1')
                .send({title: 'some title', user: 3, _id: 2})
                .expect(200, {title: 'some title', user: 3, _id: 2, content: 'from pre update hook'}, done);
        });
        it(`pre find hook`, done => {
            request(app)
                .get('/api/posts')
                .expect(200, [{title: 'some title', user: 1, _id: 1, content: 'from pre create hook'}], done);
        });
        it(`post findOne hook`, done => {
            request(app)
                .get('/api/posts/2')
                .set('TEST-POST-FINDONE-HOOK', true)
                .expect(200, {title: 'some title', user: 3, _id: 2, content: 'from post findOne hook'}, done);
        });
        it(`post get hook`, done => {
            request(app)
                .get('/api/posts/2')
                .set('TEST-POST-GET-HOOK', true)
                .expect(200, {title: 'some title', user: 3, _id: 2, content: 'from post get hook'}, done);
        });
        it(`post multiple hook 1`, done => {
            request(app)
                .get('/api/posts/2')
                .set('TEST-POST-MULTIPLE-HOOKS', true)
                .expect(200, {title: 'some title', user: 3, _id: 2, content: 'from post multiple hooks'}, done);
        });
        it(`post multiple hook 2`, done => {
            request(app)
                .get('/api/posts')
                .query({limit: 1 })
                .set('TEST-POST-MULTIPLE-HOOKS', true)
                .expect(200, [{title: 'some title', user: 1, _id: 1, content: 'from post multiple hooks'}], done);
        });
        it(`pre delete hook`, done => {
            request(app)
                .delete('/api/posts/1')
                .expect(400, {message: 'Oops!'}, done);
        });

        it(`middleware`, done => {
            request(app)
                .get('/api/posts/count')
                .expect(401, {message: 'count op not allowed for you!'}, done);
        });
        it(`hide`, done => {
            request(app)
                .get('/api/posts/2')
                .expect(200, {title: 'some title', user: 3, _id: 2, content: 'from pre update hook'}, done);
        });
    });

});

