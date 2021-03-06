/**
 * Finances.js
 * @author Khaliq Gant
 * @desc main entry point into the app, this app manages state and makes calls
 * @dependencies :
 *      Moment.js : https://github.com/moment/moment
 *      Backbone : http://backbonejs.org/
 *      Underscore : http://underscorejs.org/
 *      jQuery : https://jquery.com/
 *      enquire : https://github.com/WickyNilliams/enquire.js/
 *      sweetAlert : https://github.com/t4t5/sweetalert
 *      Q : https://github.com/kriskowal/q
 *      vis : https://github.com/almende/vis
 *      fx : https://github.com/openexchangerates/money.js
 */

/* global document */
/* global window */
/* global location */
/* global swal */
/* global Custombox */

'use strict';

var $           = require('jquery');
var _           = require('underscore');
var Backbone    = require('backbone');
var server      = require('./server');
var connect     = require('./connect');
var vars        = require('./vars');
var openEx      = require('./open-exchange');
var moment      = require('moment');
var sweetAlert  = require('sweetalert');
var enquire     = require('enquire.js');
var bunyan      = require('bunyan');
var TapListener = require('tap-listener');
var Q           = require('q');
var fx          = require('money');

var DateView = require('./views/date');
var PencilView = require('./views/pencil');
var VisualizationView = require('./views/visualization');
var IncomeView = require('./views/income');
var InfoView = require('./views/info');
var InputView = require('./views/input');
var InfoInputView = require('./views/infoInput');
var InfoAddView = require('./views/infoAdd');

var OverviewModel = require('./models/overview');
var DateModel = require('./models/date');
var VisualizeModel = require('./models/visualize');
var LayoutModel = require('./models/layout');

var Finances = (function(){
    var debug = false;
    var log = bunyan.createLogger({name: 'Finances', level: 'debug'});

    var app = {
        date: DateModel,
        mobile : false,
        current : null,
        money : null,
        financials : 0,
        check : 0,
        income : 0,
        debt : 0,
        toPay : 0,
        investments : 0,
        sections : LayoutModel.toJSON().sections,
        visualize: VisualizeModel,
        balancesRetrieved: false,
    };

    /**
     * Financial View
     * @desc handles the render logic by grabbing corresponding JSON and
     *      nested json by iterating through the json keys and checking for a
     *      remote key
     */
    var Financial = Backbone.View.extend({
        initialize : function(options) {
            this.val = options.val;
            this.model = new options.model();
            this.render();
        },
        render : function() {
            var self = this;
            this.model.fetch({
                success : function(model, response, options) {
                    // store this model for easier access
                    app.current = model.toJSON();
                    if (typeof(self.val) === 'object') {
                        // iterate through all the values we want to grab
                        _.each(self.val, function(val) {
                            methods.renderHandler(val);
                        });
                    } else {
                        // single value to obtain
                        methods.renderHandler(self.val);
                    }
                },
                error : function(model, response, options) {
                    console.log('DEBUG : bad json?');
                }
            }).done(function(){
                app.check++;
                // so we know when all financials have been returned
                if (app.check === app.financials) {
                    methods.postApplications();
                    methods.calculations.init();
                    methods.updateOverview();
                    methods.addNotePluses();
                    methods.computeTrends();
                    methods.getAndWriteBalances();
                    new InfoView();
                }
            });

            return this;
        }
    });

    var methods = {
        /**
         * Kick Off
         * @desc methods to run only once on app start
         */
        kickOff: function() {
            if (!vars.isLocal) {
                $.getJSON(
                    openEx.url + openEx.id,
                    function(data) {
                        // Check money.js has finished loading:
                        if (typeof(fx) !== 'undefined' && fx.rates) {
                            fx.rates = data.rates;
                            fx.base = data.base;

                            vars.exchange = data.rates[openEx.currency];
                        } else {
                            // If not, apply to fxSetup global:
                            var fxSetup = {
                                rates : data.rates,
                                base : data.base
                            };
                            vars.exchange = data.rates[openEx.currency];
                        }
                        $(vars.overview.rate).text(openEx.currency);
                        $(vars.overview.fx).text(vars.exchange);
                    }
                );
            } else {
                 $(vars.overview.rate).parent().hide();
            }
        },

        init : function() {
            var Month = Backbone.Model.extend({
                url : 'data/' + DateModel.get('current') + '.json',
            });

            // grab the json by specifying the correct key
            var Money = new Financial({
                val : app.sections,
                model : Month
            });
            app.financials++;

            app.money = Money.model.attributes;
            OverviewModel.set('sectionModels', Money);

            server.nextMonthCheck(DateModel.get('current'));
            server.previousMonthCheck(DateModel.get('current'));
        },

        reset : function(callback) {
            // don't lose the section we were in before
            var height = $('main').children().first().height();
            $('main').children().first().height(height);

            // clear everything out
            for (var i = 0; i < app.sections.length; i++)
            {
                $(vars[app.sections[i]]).html('');
            }
            if (typeof(callback) === 'function') {
                callback(true);
            }
        },

        /**
         * Refresh
         * @desc restart the app with an reset then init call
         */
        refresh : function() {
            methods.reset(function(done){
                methods.init();
            });
        },

        renderHandler : function(val) {
            if (!app.current[val]) {
                return;
            }

            if (app.current[val].hasOwnProperty('remote') &&
                app.current[val].remote)
            {
                // get another file
                var Model = Backbone.Model.extend({
                    url : 'data/' + app.current[val].file
                });
                var View = new Financial({
                    val : val,
                    model : Model
                });
                // keep track of where we are in the app rendering
                app.financials++;
            }
            methods.renderData(val);
        },
        /**
         * Render Data
         * @desc render data return from backbone model into the DOM
         * @param {object} data
         * @return void
         */
        renderData : function(val) {
            // map the data
            var datas = app.current[val];
            _.each(datas, function(data, index) {
                if (!data.remote) {
                    // it's a number, append it right away
                    if (typeof(datas[index]) === 'number') {
                        $(vars[val]).append(
                            '<ul>'+
                                index.ucfirst() + ' : ' +
                                '<span class="numerical js-value" '+
                                    'data-value="'+ datas[index] +'">'+
                                        '$' + datas[index] +
                                '</span>' +
                            '</ul>'
                        );
                    } else {
                        var nested = false;
                        var hasInfo = false;
                        var items = _.map(
                            // need to adjust logic to obtain credit cards here
                            _.pairs(data), function(pair) {
                                var key = pair[0].ucfirst();
                                var keyClass = '.' + pair[0];

                                // we append the info as a tooltip
                                if (pair[1].hasOwnProperty('info')) {
                                    hasInfo = true;
                                }

                                if (typeof(pair[1]) === 'object') {
                                    nested = true;
                                }
                                if (methods.numberCheck(key)) {
                                    key = '';
                                    keyClass = '';
                                }
                                return {
                                    key : key.strip(),
                                    keyClass : keyClass,
                                    keyName : pair[0],
                                    value : pair[1]
                                };
                            }
                        );

                        if (index !== 'file' && index !== 'remote') {
                            var template = methods.templateBuilder(
                                index, nested, hasInfo
                            );

                            var appendEl = vars[val];
                            var appendNest = false;
                            _.each(items, function(item){
                                var check = $(vars[val])
                                                .find(item.keyClass).length;
                                if (check > 0) {
                                    // apply based on logic
                                    methods.appendNested(item,val);
                                    appendNest = true;
                                }
                            });

                            if (!appendNest) {
                                $(appendEl).append(template({
                                    list : items
                                }));

                                if (nested) {
                                    methods.renderNested(vars[val],items);
                                }
                            }
                        }
                    }
                } else {
                    // this file is remote
                    var parentClass = $(vars[val]).parent().attr('class');
                    var Model = Backbone.Model.extend({
                        url : 'data/' + data.file
                    });
                    var View = new Financial({
                        val : index,
                        model : Model
                    });
                    app.financials++;
                }
            });
        },

        /**
         * Append Nested
         * @desc append the nested values of key value pairs
         * @param {object} item
         * @param {object} value
         */
        appendNested : function(item,val) {
            if (debug) {
                log.trace('The item is: ');
                log.debug(item.value);
                if (!item.value.hasOwnProperty('next_month')) {
                    log.warn('this element doesn\'t have a next month');
                }
            }

            if (item.value.hasOwnProperty('next_month')) {
                var month = item.value.next_month ?
                    moment(DateModel.get('current'), 'YYYY_MM').month() + 2 :
                    moment(DateModel.get('current'), 'YYYY_MM').format('M');
                if (month > 12) {
                    month = 1;
                }
                var date = month + '/' + item.value.date;
                var dueOrClosing = !item.value.hasOwnProperty('paid') ?
                    'Closing Date' : '<strong>Due Date</strong>';
                // make due date bold for the date as well
                if (item.value.hasOwnProperty('paid')) {
                    date = '<strong>'+ date + '</strong>';
                }
                $(vars[val]).find(item.keyClass)
                    .append(' (' + dueOrClosing + ' : ' + date + ')');
            } else {
                if (debug) {
                    log.warn('this element is missing a next month prop');
                    log.debug(item.value);
                }
            }

            if (item.value.hasOwnProperty('paid')){
                var checked = item.value.paid ? 'checked' : '';
                var checkbox = '<input name="paid" class="checkbox js-'+
                    item.keyClass+' js-paid" type="checkbox" '+ checked +
                    ' data-key="'+item.keyName+'">';
                $(vars[val]).find(item.keyClass).parent()
                    .append(' <span class="check">Paid : ' +
                            checkbox +
                            '</span>');
            } else {
                if (debug) {
                    log.warn('this element is missing a paid prop');
                    log.debug(item.value);
                }
            }

            // @KJG TODO this logic is suspect since sometimes links remote file
            // are finished loading before due dates remote file
            if (item.value.hasOwnProperty('link')) {
                var content = $(vars[val]).find(item.keyClass).html();
                $(vars[val]).find(item.keyClass).replaceWith(
                    '<a target="_blank" href="'+item.value.link+'">' +
                        titleCase(content.strip()) +
                    '</a>'
                );
            }
        },

        /**
         * Template Builder
         * @desc formulate a template string based on some rules
         * @param {string} index
         * @param {boolean} nested
         * @return {string} template - underscore string function
         */
        templateBuilder : function(index, nested, hasInfo) {
            var template = null;
            var openTag, closeTag;
            if (hasInfo) {
                openTag = '<ul class="circle" data-name="'+index+'">' +
                    '<span class="section js-'+index+'">' +
                        index.ucfirst().strip() +
                    '</span>';
                closeTag = '</ul>';
                template = _.template(
                     openTag +
                        '<% _(list).each(function(field) { %>'+
                            '<li class="<%= field.keyName %>" '+
                                'data-key=<%= field.keyName %>>'+
                                '<% if (field.key !== "") { %>' +
                                    '<%= field.key %> : '+
                                    '<span class="numerical js-value"'+
                                    ' data-has-info="<%= field.value.info %>"' +
                                    ' data-value="<%= field.value.value || field.value %>">$' +
                                    '<% } %>'+
                                '<%= field.value.value || field.value %>'+
                                    vars.pencilHtml +
                                '<% if (field.key === "") { %>' +
                                    '<i class="fa fa-trash-o js-remove"></i>'+
                                '<% } %>'+
                                '<% if (field.key !== "") { %>' +
                                    '</span>'+
                                '<% } %>'+
                                '<% if (field.value.value) { %>' +
                                    ' <i class="fa fa-info-circle js-info"' +
                                        'title="<%= field.value.info %>"' +
                                    '>' +
                                    '</i>' +
                                '<% } %>' +
                            '</li>'+
                        '<% }); %>' +
                    closeTag
                );
            } else if (nested) {
                template = _.template(
                    '<% _(list).each(function(field) { %>'+
                        '<ul class="circle" data-name="<%= field.key %>">'+
                        '<%= field.key %></ul>'+
                    '<% }); %>'
                );
            } else {
                openTag = '<ul class="circle" data-name="'+index+'">' +
                                    '<span class="section js-'+index+'">' +
                                        index.ucfirst().strip() +
                                    '</span>';
                closeTag = '</ul>';
                template = _.template(
                     openTag +
                        '<% _(list).each(function(field) { %>'+
                            '<li class="<%= field.keyName %>" '+
                                'data-key=<%= field.keyName %>>'+
                                '<% if (field.key !== "") { %>' +
                                    '<%= field.key %> : '+
                                    '<span class="numerical js-value"'+
                                    ' data-value="<%= field.value %>">$' +
                                    '<% } %>'+
                                '<%= field.value %>'+
                                    vars.pencilHtml +
                                '<% if (field.key === "") { %>' +
                                    '<i class="fa fa-trash-o js-remove"></i>'+
                                '<% } %>'+
                                '<% if (field.key !== "") { %>' +
                                    '</span>'+
                                '<% } %>'+
                                ' <i class="fa fa-plus info-plus ' +
                                    'js-info-create">' +
                                '</i>' +
                            '</li>'+
                        '<% }); %>' +
                    closeTag
                );
            }

            return template;
        },


        /**
         * Map Note Data
         */
        mapNoteData : function(model,name,key,value) {
            var file, entryPoint, date;
            if (model.remote) {
                file = 'data/' + model.file;
                entryPoint = file.split('/')[1];
                date = file.split('/')[2].replace('.json','');
            }

            var data = {
                file : file,
                entryPoint : entryPoint,
                name : name,
                key : key,
                value : value,
                date : date,
                currentDate : DateModel.get('current')
            };

            return data;
        },



        /**
         * Number Check
         * @desc check if a typeof string is actually a number
         * @param {string} n
         * @ref http://stackoverflow.com/questions/16799469/how-to-check-if-a-string-is-a-natural-number
         */
        numberCheck : function(n) {
            // force the value in case it is not
            n = n.toString();
            var n1 = Math.abs(n),
            n2 = parseInt(n, 10);
            return !isNaN(n1) && n2 === n1 && n1.toString() === n;
        },

        /**
         * Render Nested
         * @desc render the nested data of the object
         * @param {object} els
         * @param {object} items
         * @return DOM manipulation
         */
        renderNested : function(els, items){
            var nestedTemplate = null;
            _.each($(els).children(), function(el){
                var className = $(el).attr('data-name');
                nestedTemplate = _.template(
                '<% _(list).each(function(field) { %>'+
                    '<li data-key="<%= field.key.toLowerCase() %>">'+
                        '<span class="<%= field.keyClass %>"'+
                            '><%= field.key %>'+
                        '</span> : '+
                        '<span class="js-value numerical"'+
                        'data-value="<%= field.value %>">'+
                            '$<%= field.value %>'+
                            vars.pencilHtml +
                            vars.eyeHtml +
                        '</span>' +
                    '</li>'+
                '<% }); %>'
                );
                _.each(items, function(item){
                    if (item.key === className) {
                        var nestedItems = _.map(
                            _.pairs(item.value), function(pair) {
                                return {
                                    keyClass : pair[0],
                                    key : pair[0].ucfirst(),
                                    value : pair[1]
                                };
                            }
                        );
                        $(el).append(nestedTemplate({
                            list : nestedItems
                        }));
                    }
                });
            });
        },

        postApplications : function(){
            // investments are optional
            $(vars.investmentContainer).append(
                '<input class="checkbox '+vars.investmentsClass+
                '" type="checkbox">'
            );
            $(vars.investments).prop('checked', true);
            app.investments = $(vars.investmentContainer)
                .find('.numerical').attr('data-value');

            // how many notes are there?
            var notes = $(vars.notes).find('.section').length;
            $(vars.notesHeader).html('Notes ('+notes+')');

        },

        /**
         * Add Note Pluses
         * @desc add in a plus sign to each note
         */
        addNotePluses : function() {
            $(vars.notes + ' .circle').each(function(){
                $(this).append(vars.plusHtml);
            });
        },

        /**
         * Get And Write Balances
         * @desc grab credit and debit balances using connect api
         */
        getAndWriteBalances: function() {
            // only make these API calls once
            if (!app.balancesRetrieved) {
                // this will get written to file as well if different
                var changed = false;
                var changedArray = [];
                connect.get('bofa').then(function(balance) {
                    if (balance !== null) {
                        if (+OverviewModel.get('sectionModels').model.get('debt')
                                .credit_cards.visa.bofa_cash !== balance.cash)
                        {
                            OverviewModel.get('sectionModels').model.get('debt')
                                .credit_cards.visa.bofa_cash = balance.cash;
                            changed = true;
                            changedArray.push('bofa_cash');
                        }

                        if (balance.travel !== null &&
                            +OverviewModel.get('sectionModels').model.get('debt')
                                .credit_cards.visa.bofa_travel !== balance.travel)
                        {
                            OverviewModel.get('sectionModels').model.get('debt')
                                .credit_cards.visa.bofa_travel = balance.travel;
                            changed = true;
                            changedArray.push('bofa_travel');
                        }

                        if (changed) {
                            methods.reSyncDebt(changedArray);
                        }
                    }
                    app.balancesRetrieved = true;

                });

                connect.get('checking').then(function(balance) {
                    if (balance !== null) {
                        var convert;
                        if (!vars.isLocal) {
                            convert = fx(balance.depository)
                                    .from(openEx.base)
                                    .to(openEx.currency)
                                    .toFixed(2);
                        } else {
                            convert = 0;
                        }
                        $(vars.overview.checking).text(
                            '$' + balance.depository +
                            ' (' + convert + ' ' + openEx.currency + ')'
                        );
                        if (!vars.isLocal) {
                            convert = fx(balance.brokerage)
                                    .from(openEx.base)
                                    .to(openEx.currency)
                                    .toFixed(2);
                        } else {
                             convert = 0;
                        }
                        $(vars.overview.savings).text(
                            '$' + balance.brokerage +
                            ' (' + convert + ' ' + openEx.currency + ')'
                        );
                    }
                    app.balancesRetrieved = true;
                });

            }

        },

        /**
         * Re Sync Debt
         * @desc iterate through based on the model and update the DOM
         */
        reSyncDebt: function(changedArray) {
            _.each(OverviewModel.get('sectionModels').model.get('debt').credit_cards, function(cat,cards)
            {
                _.each(cat, function(value, card) {
                    if (changedArray.indexOf(card) !== -1) {
                        $(vars.debt + ' .circle[data-name='+cards.ucfirst()+']')
                            .find('li[data-key='+card+']').find('.numerical')
                            .attr('data-value', value)
                            .html('$'+ value + vars.pencilHtml);
                        // now save this to the db
                        server.postIt(
                            'debt',
                            'debt',
                            card,
                            value,
                            cards,
                            'credit_cards',
                            DateModel.get('current'),
                            function(result) {
                                if (result) {
                                    // file updated successfully
                                    methods.calculations.debt();
                                }
                            });
                    }
                });
            });
        },

        /**
         * Compute Trends
         * @desc calculate trends and append to the trend box
         *      and add information for visualization data
         */
        computeTrends : function() {
            Q.allSettled([
                    server.postPromise(undefined, 'average'),
                    server.getPromise('data/analysis/stats.json')])
            .spread(function(averageResponse, statsResponse)
            {
                if (averageResponse.state === 'fulfilled' &&
                    statsResponse.state === 'fulfilled')
                {
                    // store this info for the visualizations
                    VisualizeModel.all_cards = averageResponse.value.cards;
                    VisualizeModel.all_dates = averageResponse.value.dates;
                    VisualizeModel.stats = statsResponse.value;

                    // add average to DOM
                    var average = averageResponse.value.average;
                    Finances.app.average = app.average = average.toFixed(2);
                    $(vars.toPayAvg).text('$' + average.toFixed(2));
                    var diff = (app.toPay - app.average).toFixed(2);
                    var posOrNeg = diff > 0 ? '+' : '';
                    var diffClass = diff < 0 ? 'plus' : 'negative';
                    $(vars.difference).removeClass('plus negative');
                    $(vars.difference).html('('+posOrNeg + diff+')')
                        .addClass(diffClass);
                }
            });
        },

        updateOverview : function() {
            // find the diff
            var difference = OverviewModel.get('income') - app.toPay;
            $(vars.overview.short).text('$'+difference.toFixed(2));
            if (difference < 0) {
                $(vars.overview.short).removeClass('plus');
                $(vars.overview.short).addClass('minus');
            } else {
                $(vars.overview.short).removeClass('minus');
                $(vars.overview.short).addClass('plus');
            }

            // report the date
            $(vars.overview.date).html(
                moment().format('dddd, MMMM Do YYYY')
            );

            // update the to pay key
            var left = 0;
            _.each($(vars.to_pay + ' li'),function(el){
                if (!$(el).find(vars.paid).is(':checked')) {
                    left += parseFloat(
                        $(el).find(vars.value).attr('data-value')
                    );
                }
            });

            $(vars.overview.left).html('$' + left.toFixed(2));
        },

        updateMonth : function(setMonth) {
            var month = typeof(setMonth) === 'undefined' ?
                moment().format('MMMM') : setMonth;
            $(vars.monthHeader).text(month);
        },

        calculations : {
            init : function(){
                methods.calculations.income();
                methods.calculations.debt();
                methods.calculations.toPay();
            },

            /**
             * Income
             * @desc given what is on the dom, make the calculation to find the
             *      total income
             */
            income : function() {
                IncomeView.payCalculations();
            },

            debt : function(){
                var debts = 0;
                _.each($(vars.debt + ' .numerical'), function(el){
                    var num = $(el).attr('data-value');
                    debts += parseFloat(num);
                });

                debts = debts.toFixed(2);
                $(vars.payments.header).html(
                    ': $'+ debts
                );
                $(vars.payments.section).html(
                    'Total: $' + debts
                );
                app.debt = debts;
            }, //end debt function

            toPay : function() {
                var pay = 0;
                _.each($(vars.to_pay + ' .numerical'), function(el){
                    var num = $(el).attr('data-value');
                    pay += parseFloat(num);
                });

                $(vars.toPay.header).html(
                    ': $'+ pay.toFixed(2)
                );
                $(vars.toPay.section).html(
                    'Total: $' + pay.toFixed(2)
                );

                // assign to the app object for convenience
                app.toPay = pay;
            }, //end toPay function
        }, //end calculations obect
    }; // end methods object

    var listeners = {
        init : function(){
            $(document).on('change', vars.investments, function(){
                var $parent = $(this).parent();
                var $el = $parent.find('.numerical');
                var checked = $(this).prop('checked');
                if (checked) {
                    $el.attr('data-value',app.investments);
                    $el.text('$' + app.investments);
                } else {
                    $el.attr('data-value',0);
                    $el.text('$0');
                }
                methods.calculations.income();
                methods.updateOverview();
            });

            /**
             * Paid checkbox listener
             * @desc send off a post request when the paid checkbox is changed
             */
            $(document).on('change', vars.paid, function(){
                var checked = $(this).prop('checked');
                // get the model file that corresponds to paid
                var model = OverviewModel.get('sectionModels').model.get('debt').due_dates;
                var data = listeners.methods.mapInputData($(this));

                var result = server.postIt(
                    model,
                    data.name,
                    data.key,
                    checked,
                    data.parent,
                    undefined,
                    DateModel.get('current'),
                    function(result) {
                        if (result) {
                            methods.updateOverview();
                        }
                    }
                );
            });

            /**
             * Confirm input box || enter key in input
             * @desc change and send off post request and update
             */
            $(document).on('click', vars.confirm, function(){
                var $self = $(this).prev();
                listeners.methods.inputHandler($self);
            });
            $(document).on('keyup', vars.payInput, function(e){
                if (e.keyCode === 13) {
                    listeners.methods.inputHandler($(this));
                }
            });

            /**
             * Confirm note add || enter on input box
             */
            $(document).on('click', vars.noteConfirm, function(){
                var $self = $(this).prev();
                listeners.methods.addNoteHandler($self);
            });
            $(document).on('keyup', vars.noteInput, function(e){
                if (e.keyCode === 13) {
                    listeners.methods.addNoteHandler($(this));
                }
            });

            /**
             * Add Note Section
             * @event click
             * @desc show the input box and confirm button
             */
            $(document).on('click', vars.newNoteCategory, function() {
                var noteCatHtml = '<input name="notes"' +
                                'type="text" ' +
                                'class="text-input js-note-cat-input">'+
                                ' <i class="fa fa-check-circle '+
                                'js-new-note-category">'+
                                '</i>';
                $(this).replaceWith(noteCatHtml);
            });

            /**
             * Confirm note add || enter on input box
             */
            $(document).on('click', vars.addNoteCategory, function(){
                var $self = $(this).prev();
                listeners.methods.addNoteCatHandler($self);
            });
            $(document).on('keyup', vars.noteCatInput, function(e){
                if (e.keyCode === 13) {
                    listeners.methods.addNoteCatHandler($(this));
                }
            });

            /**
             * Increase/Decrease Month Listener
             */
            $(document).on('click', vars.increaseMonth, function(e){
                e.preventDefault();
                vars.monthCount++;
                var last = DateModel.get('current');
                var month = moment()
                        .add(vars.monthCount,'months').format('MMMM');
                methods.updateMonth(month);
                var nextDate = moment()
                        .add(vars.monthCount,'months').format('YYYY_MM');
                DateModel.set('current', nextDate);

                // make a new file
                if ($(this).hasClass('inactive')){
                    var data = {
                        lastMonth : $(this).attr('data-lastMonth'),
                        file : $(this).attr('data-url'),
                        rawDate : $(this).attr('data-rawDate'),
                        rawDateLast : last
                    };
                    server.newMonth(data,function(done){
                        methods.reset(function(){
                            methods.init();
                        });
                    });

                } else {
                    methods.reset(function(done){
                        methods.init();
                    });
                }
            });
            $(document).on('click', vars.decreaseMonth, function(e){
                e.preventDefault();
                vars.monthCount--;
                var month = moment()
                        .add(vars.monthCount,'months').format('MMMM');
                methods.updateMonth(month);
                var previousDate = moment()
                        .add(vars.monthCount,'months').format('YYYY_MM');
                DateModel.set('current', previousDate);
                // re-initialize the app
                methods.reset(function(done){
                    methods.init();
                });
            });
            // reset month to 0, by clicking on the month
            $(document).on('click', vars.monthHeader, function(e){
                e.preventDefault();
                vars.monthCount = 0;
                methods.updateMonth();
                DateModel.reset();
                methods.reset(function(done){
                    methods.init();
                });
            });

            /**
             * Refresh
             * @desc refresh the app by clicking the refresh button
             */
            $(document).on('click', vars.refresh, function(e){
                methods.refresh();
            });

            /**
             * Remove
             * @desc action on trash can delete icon
             */
            $(document).on('click', vars.remove, function(e){
                var content;
                if (app.mobile) {
                    content = 'Delete this note?';
                } else {
                    var note = $(this).parent('li').text();
                    content = 'You sure you want to delete this note <br/>"' +
                        note + '"';
                }
                var self = this;
                sweetAlert({
                    title: 'Delete Note',
                    text: content,
                    type: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#DD6B55',
                    confirmButtonText: 'Remove',
                    closeOnConfirm: false,
                    html: true
                }, function(){
                    // sent request to remove
                    var noteData = listeners.methods.mapNoteData($(self));
                    var data = methods.mapNoteData(
                        noteData.model,
                        noteData.name,
                        noteData.keyName,
                        noteData.value
                    );

                    server.note.remove(
                        data,
                        function(result){
                            if (result) {
                                // refresh the app, instead of changing li keys
                                methods.reset(function(done){
                                    methods.init();
                                });
                            }
                        }
                    );
                    swal('Removed',
                         'Your note has been removed',
                         'success');
                });
            });

            /**
             * Change note to input box on click
             */
            $(document).on('click', vars.addNote, function(){
                var key = $(this).parents('.circle').attr('data-name');
                var noteInputHtml = '<input name="notes"' +
                                'type="text" data-model="notes" '+
                                'data-key="'+key+'"'+
                                'class="text-input js-note-input">'+
                                ' <i class="fa fa-check-circle '+
                                'js-confirm-note">'+
                                '</i>';
                $(this).before(noteInputHtml);
                $(this).parents('.circle').find(vars.noteInput).focus();
            });

            /**
             * Hide overview and trend box if clicked/tap
             */
            var financeEl = document.getElementsByClassName(
                Finances.vars.overviewBoxClass)[0];
            var tapperF = new TapListener(financeEl);
            tapperF.on('tap',function(e){
                listeners.methods.overviewHide(financeEl);
            });

            var trendEl = document.getElementsByClassName(
                Finances.vars.trendBoxClass)[0];
            var tapperE = new TapListener(trendEl);
            tapperE.on('tap',function(e){
                listeners.methods.overviewHide(trendEl);
            });


            // immediately invoked
            methods.updateMonth();

            /**
             * Enquire listener to make the dollar icon also be a dropdown
             */
            enquire.register('screen and (max-width: 375px)', {
                match: function() {
                    $(document).on('click', vars.dropdown.listener, function(){
                        $(vars.dropdown.el).toggle();
                    });
                    app.mobile = true;
                },

            });
        }, // end init function

        methods : {
            mapInputData : function($el) {
                var data = {};
                data.name = $el.attr('name');
                data.key = $el.attr('data-key');
                data.parent = $el.parents('.circle').attr('data-name')
                                                .toLowerCase();
                return data;
            },

            mapNoteData : function($self) {
                var noteData = {};
                noteData.model = $self.parents('.financial').attr('data-model');
                if (OverviewModel.get('sectionModels').model.get(noteData.model).remote) {
                    noteData.model = OverviewModel.get('sectionModels').model.get(noteData.model);
                }
                noteData.name = $self.parents('.circle').attr('data-name');
                noteData.keyName = $self.parent('li').attr('data-key');

                return noteData;
            },

            /**
             * Add Note Handler
             * @desc logic to send post to add a note
             */
            addNoteHandler : function($self) {
                var key = $self.attr('data-key');
                var value = $self.val();
                var model = $self.attr('data-model');
                var file = OverviewModel.get('sectionModels').model.get(model).file;

                if (value !== '') {
                    server.note.add(
                        file,
                        model,
                        value,
                        key,
                        function(result) {
                            methods.reset(function(done){
                                methods.init();
                            });
                        }
                    );
                }
            },

            /**
             * Add Note Cat Handler
             * @desc take in information and send to the server for the new
             *       note category
             * @param {object} $el
             */
            addNoteCatHandler: function($el) {
                var data = {
                    file: OverviewModel.get('sectionModels').model.get('notes').file,
                    category: $el.val()
                };
                var endpoint = 'addNoteCategory';
                server.postPromise(data, endpoint).then(function(resp) {
                    // replace the content category content and remove content
                    $(vars.addNoteCategory).remove();
                    $(vars.noteCatInput).replaceWith(vars.noteCatHtml);
                    methods.reset(function(done){
                        methods.init();
                    });
                });
            },

            inputHandler : function($self) {
                var key = $self.attr('data-key');
                var info = $self.attr('data-info');
                var value = $self.val();
                var model, result;
                // remove dollar sign if there
                if (value === '') {
                    value = $self.parent('li').find('.js-value')
                                    .attr('data-value');
                }
                value = value.replace('$','');
                // make sure it is a number
                if (!isNaN(value)) {
                    var object;
                    model = $self.parents('.financial').attr('data-model');
                    if (OverviewModel.get('sectionModels').model.get(model).remote) {
                        model = OverviewModel.get('sectionModels').model.get(model);
                        object = false;
                    }
                    var data = listeners.methods.mapInputData($self);
                    object = typeof(object) !== 'undefined' ?
                        false : $self.parents('.financial').attr('data-object');

                    // if there is info associated build that out
                    if (info) {
                        value = {
                            value: value,
                            info: info
                        };
                    }

                    server.postIt(
                        model,
                        data.name,
                        data.key,
                        value,
                        data.parent,
                        object,
                        DateModel.get('current'),
                        function(result) {
                            if (result) {
                                $(vars.payInput).hide();
                                $(vars.confirm).hide();
                                $self.parent('li').find('.numerical')
                                    .attr('data-value', value.value || value).html(
                                        '$'+ (value.value || value) + vars.pencilHtml)
                                    .css('display','inline-block');
                                // update the calculations
                                methods.calculations.income();
                                methods.calculations.debt();
                                methods.calculations.toPay();
                                methods.updateOverview();
                            }
                        });
                } else {
                    // must be a note that was entered
                    var noteData = listeners.methods.mapNoteData($self);

                    var postData = methods.mapNoteData(noteData.model,
                                                   noteData.name,
                                                   noteData.keyName,
                                                   value
                                                  );
                    server.note.update(
                        postData,
                        function(result){
                            if (result) {
                                var updateContent = $self.val() === '' ?
                                    $self.attr('data-value') : $self.val();
                                $self.parent('li').html(
                                    updateContent + vars.pencilHtml
                                );
                            }
                        }
                    );
                }
            }, // end inputHandler

            /**
             * OverviewHide
             * @desc show or hide the overview box on tap or click
             */
            overviewHide : function(el) {
                if ($(el).hasClass('thrown')) {
                    $(el).css('left', 'initial');
                    $(el).removeClass('thrown');
                } else {
                    var width = $(window).width();
                    $(el).css('left', width - 20);
                    $(el).addClass('thrown');
                }
            }, //end overviewHide
        },// end methods object within listeners
    }; // end listeners object

    String.prototype.ucfirst = function(){
        return this.charAt(0).toUpperCase() + this.slice(1);
    };
    String.prototype.strip = function(){
        return this.replace('_',' ');
    };

    // http://stackoverflow.com/questions/4878756/javascript-how-to-capitalize-first-letter-of-each-word-like-a-2-word-city
    function titleCase(str) {
        return str.replace(/\w\S*/g, function(txt){return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});
    }

    var API = {
        app : app,
        vars : vars,
        methods : methods,
        listeners : listeners
    };
    // because browserify doesn't bind to the window, put finances & $ in the
    // window, instead of returning it
    window.Finances = API;
    window.$ = $;
    return API;
})();

$(document).ready(function() {
    Finances.methods.kickOff();
    Finances.methods.init();
    Finances.listeners.init();
});

