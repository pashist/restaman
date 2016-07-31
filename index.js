'use strict';

const mongoose = require('mongoose');
const express = require('express');
const bodyParser = require('body-parser');
const getParamNames = require('get-parameter-names');
const forEach = require('lodash').forEach;

mongoose.Promise = global.Promise;


class ModelWrapper {

    constructor(model) {
        this.modelName = model.modelName || model;
        this.hooks = {
            pre: {},
            post: {}
        };
        this.middlewares = {};
        /**
         * Exposed instance methods
         * @type {Array}
         */
        this.methods = [];
        /**
         * Exposed static methods
         * @type {Array}
         */
        this.statics = [];
        /**
         * Hidden fields
         * @type {Array}
         */
        this.hidden = [];

        this.db = function (name) {
            return name ? mongoose.connection.useDb(name) : mongoose;
        };
    }

    /**
     * Return model from named db if presented in args otherwise from default db
     * @param {Object=} params
     * @returns {*}
     */
    model(params) {
        let dbname = params ? params.db : null;
        return this.db(dbname).model(this.modelName);
    };

    applyHooks(type, action, req, res, data) {
        var hooksToApply = [];

        if (this.hooks[type][action]) {
            hooksToApply = hooksToApply.concat(this.hooks[type][action]);
        }
        if (this.hooks[type].all) {
            hooksToApply = hooksToApply.concat(this.hooks[type].all);
        }
        hooksToApply.forEach(function (hook) {
            hook(req, res, data);
        })
    };

    addHook(type, action, callback) {
        if (!this.hooks[type][action]) {
            this.hooks[type][action] = [];
        }
        if (action instanceof Array) {
            action.forEach(_action => this.addHook(type, _action, callback))
        } else {
            this.hooks[type][action].push(callback);
        }
    };

    setMiddleware(action, callback) {
        if (action instanceof Array) {
            action.forEach(val => this.setMiddleware(val, callback))
        } else {
            this.middlewares[action] = callback
        }
    };

    getMiddleware(action) {
        return this.middlewares[action] || this.middlewares['all'] || function (req, res, next) {
                next()
            };
    };

    /**
     * Expose instance method defined for mongoose model
     * @param method
     */
    exposeMethod(method) {
        method = method instanceof Object ? method : {name: method};
        method = Object.assign({exposeName: method.name}, method);
        if (this.model()[method.name] instanceof Function) {
            this.methods.push(method);
        } else {
            throw new Error(`Instance method ${method.name} is not defined for model ${this.model().modelName}`)
        }
    };

    /**
     * Expose static method defined for mongoose model
     * @param method
     */
    exposeStatic(method) {
        method = method instanceof Object ? method : {name: method};
        method = Object.assign({exposeName: method.name}, method);
        if (this.model().schema.statics[method.name] instanceof Function) {
            let index = this.statics.findIndex(_method => _method.exposeName == method.exposeName);
            ~index ? this.statics[index] = method : this.statics.push(method); // replace if exists with same exposeName
        } else {
            throw new Error(`Static method ${method.name} is not defined for model ${this.model().modelName}`)
        }
    };

    getMethods() {
        return this.methods;
    };

    getStatics() {
        return this.statics;
    };

    findById(id, model) {
        return model.findOne({_id: id})
            .then(doc => {
                if (!doc) {
                    var error = new Error();
                    error.message = 'Not Found';
                    error.name = 'ModelNotFound';
                    error.status = 404;
                    throw error
                }
                return doc;
            })
    };

    initModel(req, res) {
        var params = {};
        this.applyHooks('pre', 'init', req, res, params);
        var model = this.model(params);
        this.applyHooks('post', 'init', req, res, model);
        return model;
    }

    pre(action, callback) {
        this.addHook('pre', action, callback);
        return this;
    };

    post(action, callback) {
        this.addHook('post', action, callback);
        return this;
    };

    middleware(action, callback) {
        if (arguments.length == 2) {
            this.setMiddleware(action, callback);
            return this;
        } else {
            return this.getMiddleware(action);
        }
    };

    /**
     * Add post hook to exclude field(s) from response object(s)
     * Note that hidden field still can be changed via update
     * @param {Array|String} args
     * @returns {ModelWrapper}
     */
    hide(args) {
        this.hidden = this.hidden.concat(args instanceof Array ? args : [args]);
        return this;
    }

    /**
     * Shortcut for exposeMethod
     * @param method
     * @returns {ModelWrapper}
     */
    method(method) {
        this.exposeMethod(method);
        return this;
    };

    /**
     * Shortcut for exposeStatic
     * @param method
     * @returns {ModelWrapper}
     */
    ['static'](method) {
        this.exposeMethod(method);
        return this;
    };

    // Route handlers

    create(req, res, next) {
        if (req.body instanceof Array || !req.body instanceof Object) {
            let error = new TypeError('Only objects allowed');
            error.statusCode = 400;
            return next(error);
        }
        const model = this.initModel(req, res);
        this.applyHooks('pre', 'create', req, res);
        model.create(req.body)
            .then(doc => {
                this.applyHooks('post', 'create', req, res, doc);
                res.send(doc)
            })
            .catch(next);
    };

    findOne(req, res, next) {
        let model = this.initModel(req, res);
        let query = parseQuery(req.query);
        query.filter._id = req.params.id;
        this.applyHooks('pre', 'findOne', req, res, query);
        let promise = model.findOne(query.filter, query.projection);
        if (query.populate) {
            promise.populate(query.populate);
        }
        promise.then(doc => {
            if (!doc) {
                throw new NotFoundError();
            }
            this.applyHooks('post', 'findOne', req, res, doc);
            res.send(doc)
        }).catch(next);
    };

    find(req, res, next) {
        let model = this.initModel(req, res);
        let query = parseQuery(req.query);
        this.applyHooks('pre', 'find', req, res, query);
        let promise = model.find(query.filter, query.projection, query.options);
        if (query.populate) {
            promise.populate(query.populate);
        }
        promise.then(docs => {
            this.applyHooks('post', 'find', req, res, docs);
            res.send(docs)
        }).catch(next);
    };

    /**
     *
     * @param {Object} req
     * @param {Object} res
     * @param {Function} next
     */
    update(req, res, next) {
        let model = this.initModel(req, res);
        this.findById(req.params.id, model)
            .then(doc => {
                this.applyHooks('pre', 'update', req, res, doc);
                return Object.assign(doc, req.body).save()
            })
            .then(doc => {
                this.applyHooks('post', 'update', req, res, doc);
                res.send(doc)
            })
            .catch(next)
    };

    delete(req, res, next) {
        var model = this.initModel(req, res);
        this.findById(req.params.id, model)
            .then(doc => {
                this.applyHooks('pre', 'delete', req, res, doc);
                return doc.remove()
            })
            .then(doc => {
                this.applyHooks('post', 'delete', req, res, doc);
                res.send(doc)
            })
            .catch(next)
    };

    count(req, res, next) {
        var model = this.initModel(req, res);
        let query = parseQuery({filter: req.query});
        this.applyHooks('pre', 'count', req, res, query);
        model.count(query.filter)
            .then((count) => {
                this.applyHooks('post', 'count', req, res, count);
                res.send({count: count})
            })
            .catch((err) => {
                next(err)
            })
    };

    callMethod(method, req, res, next) {
        var model = this.initModel(req, res);
        this.applyHooks('pre', 'method', req, res, method);
        try {
            let _method = model[method];
            let params = getParamNames(_method).map(paramName => req.body[paramName]);
            let result = _method.apply(model, params);
            (result instanceof Promise ? result : Promise.resolve(result))
                .then(result => {
                    this.applyHooks('post', 'method', req, res, method, result);
                    res.send(result);
                })
                .catch(next)
        } catch (err) {
            next(err);
        }
    };

    callStatic(method, req, res, next) {
        var model = this.initModel(req, res);
        this.applyHooks('pre', 'static', req, res, method);
        try {
            let _method = model[method];
            let params = getParamNames(_method).map(paramName => req.body[paramName]);
            let result = _method.apply(model, params);
            (result instanceof Promise ? result : Promise.resolve(result))
                .then(result => {
                    this.applyHooks('post', 'static', req, res, method, result);
                    res.send(result);
                })
                .catch(next)
        } catch (err) {
            next(err);
        }
    };
}


class Restaman {

    constructor() {
        this.models = [];
    }


    /**
     * create ModelWrapper instance
     * for given model name or mongoose Model instance
     * @param model
     * @returns {ModelWrapper}
     */
    addModel(model) {
        var modelWrapper = new ModelWrapper(model);
        if (this.getModelWrapper(modelWrapper.modelName)) {
            throw new Error('Model already registered');
        }
        this.models.push(modelWrapper);
        return modelWrapper;
    };

    /**
     * remove ModelWrapper instance
     * for given model name
     * @param model
     * @returns {Restaman}
     */
    removeModel(modelName) {
        let index = this.models.findIndex(modelWrapper => modelWrapper.modelName == modelName);
        if (~index) {
            this.models.splice(index, 1);
        }
        return this;
    };

    /**
     * return ModelWrapper instance for given model name
     * @param {String} modelName name of Mongoose model
     * @returns {ModelWrapper}
     */
    getModelWrapper(modelName) {
        return this.models.find(modelWrapper => modelWrapper.modelName == modelName)
    };

    /**
     * Prepare ModelWrapper and add to router
     */
    setupModel(modelWrapper, router) {
        modelWrapper.addHook('post', ['create', 'find', 'findOne', 'delete', 'update'], (req, res, data) => {    // todo move to wrapper

            const removeHidden = (doc) => modelWrapper.hidden.forEach(field => doc[field] = undefined);

            if (data && modelWrapper.hidden.length) {
                data instanceof Array ? data.forEach(removeHidden) : removeHidden(data);
            }
        });
        this.setupModelRoutes(modelWrapper, router);

    }
    /**
     *
     * @param {ModelWrapper} modelWrapper
     * @param {Object} router
     */
    setupModelRoutes(modelWrapper, router) {

        let path = '/' + modelWrapper.model().collection.collectionName;
        modelWrapper.getStatics().forEach(method => router.post(path + '/' + method.exposeName, (req, res, next) =>
            modelWrapper.callStatic(method.name, req, res, next)
        ));

        router
            .options(path, function (req, res) {
                res.status(204).set('Allow', 'GET, OPTIONS, DELETE, POST, PUT').end();
            })
            .get(path + '/count', modelWrapper.middleware('count'), function (req, res, next) {
                modelWrapper.count(req, res, next);
            })
            .get(path + '/:id', modelWrapper.middleware('find'), function (req, res, next) {
                modelWrapper.findOne(req, res, next);
            })
            .get(path, modelWrapper.middleware('find'), function (req, res, next) {
                modelWrapper.find(req, res, next);
            })
            .post(path, modelWrapper.middleware('create'), function (req, res, next) {
                modelWrapper.create(req, res, next);
            })
            .post(path + '/:id', modelWrapper.middleware('update'), function (req, res, next) {
                modelWrapper.update(req, res, next);
            })
            .put(path, modelWrapper.middleware('create'), function (req, res, next) {
                modelWrapper.create(req, res, next);
            })
            .delete(path + '/:id', modelWrapper.middleware('delete'), function (req, res, next) {
                modelWrapper.delete(req, res, next);
            });
    };

    initRouter(router) {
        router.use(bodyParser.json());
        this.models.forEach(model => this.setupModel(model, router));
        return this;
    };

    router(params) {
        let router = express.Router(params);
        this.initRouter(router);
        return router;
    };

}

class NotFoundError extends Error {
    constructor() {
        super('Document Not Found');
        this.statusCode = 404;
        this.name = 'Not Found';
    }
}

function parseQueryOptions(query) {
    let options = {};
    let formatters = {
        sort: value => String(value),
        skip: (value, q) => Number(value || q.start),
        limit: value => Number(value)
    };
    forEach(formatters, function (val, key) {
        if (typeof query[key] !== 'undefined') {
            options[key] = val(query[key], query);
        }
    });
    return options;
}

function parseQueryFilter(query) { //todo test
    let filter = {};
    if (query.filter !== null) {
        switch (typeof query.filter) {
            case 'object':
                filter = query.filter;
                break;
            case 'string':
                filter = parseJSON(query.filter);
                break;
        }
    }
    return filter;
}

function parseQueryPopulate(query) { //todo test
    let populate;
    if (query.populate) {
        try {
            populate = JSON.parse(query.populate);
        } catch (e) {
            populate = query.populate;
        }
    }
    return populate;
}

function parseQueryProjection(query) { //todo test
    let projection = query.projection || null;
    if (projection) {
        try {
            projection = JSON.parse(projection);
        } catch (e) {

        }
    }
    return projection;
}

function parseQuery(query) {
    return {
        filter: parseQueryFilter(query),
        populate: parseQueryPopulate(query),
        options: parseQueryOptions(query),
        projection: parseQueryProjection(query)
    }
}

function parseJSON(str) {
    let result = {};
    try {
        result = JSON.parse(str)
    } catch (e) {
    }
    return result;
}

module.exports = Restaman;
module.exports.ModelWrapper = ModelWrapper;