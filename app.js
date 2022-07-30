var express = require("express");
var moment = require("moment");
var http = require('http');
var request = require('request');
var fs = require('fs');
var Q = require('q');
//var cors = require('cors');

var app = express();
var port = process.env.PORT || 7000;
var baseDir ='https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl';

// cors config
var whitelist = [
	'http://localhost',
	'http://localhost:63342',
	'http://localhost:3000',
	'http://localhost:4500',
	'http://localhost:4000',
	'https://blotecho.coded.one'
];

var corsOptions = {
	origin: '*'
};

app.listen(port, function(err){
	console.log("running server on port "+ port);
});

app.use(express.static('public'));

//app.get('/', cors(corsOptions), function(req, res){
app.get('/', function(req, res){
    res.send('hello wind-js-server.. <br>go to /latest for wind data..<br> go to /latest_wx for misc weather');
});

//app.get('/alive', cors(corsOptions), function(req, res){
app.get('/alive', function(req, res){
	res.send('wind-js-server is alive');
});

//app.get('/latest', cors(corsOptions), function(req, res){
app.get('/latest', function(req, res){

	/**
	 * Find and return the latest available 6 hourly pre-parsed JSON data for wind
	 *
	 * @param targetMoment {Object} UTC moment
	 */
	function sendLatest(targetMoment){

		var stamp = moment(targetMoment).format('YYYYMMDD') + roundHours(moment(targetMoment).hour(), 6);
		var fileName = __dirname +"/json-data/"+ stamp +".json";

		res.setHeader('Content-Type', 'application/json');
		res.sendFile(fileName, {}, function (err) {
			if (err) {
				console.log(stamp +' doesnt exist yet, trying previous interval..');
				sendLatest(moment(targetMoment).subtract(6, 'hours'));
			}
		});
	}

	sendLatest(moment().utc());

});

//app.get('/latest_wx', cors(corsOptions), function(req, res){
app.get('/latest_wx', function(req, res){

	/**
	 * Find and return the latest available 6 hourly pre-parsed JSON data for weather
	 *
	 * @param targetMoment {Object} UTC moment
	 */
	function sendLatest(targetMoment){

		var stamp = moment(targetMoment).format('YYYYMMDD') + roundHours(moment(targetMoment).hour(), 6);
		var fileName = __dirname +"/json-wx-data/"+ stamp +".json";

		res.setHeader('Content-Type', 'application/json');
		res.sendFile(fileName, {}, function (err) {
			if (err) {
				console.log(stamp +' doesnt exist yet, trying previous interval..');
				sendLatest(moment(targetMoment).subtract(6, 'hours'));
			}
		});
	}

	sendLatest(moment().utc());

});

//app.get('/nearest', cors(corsOptions), function(req, res, next){
app.get('/nearest', function(req, res, next){

	var time = req.query.timeIso;
	var limit = req.query.searchLimit;
	var searchForwards = false;

	/**
	 * Find and return the nearest available 6 hourly pre-parsed JSON data
	 * If limit provided, searches backwards to limit, then forwards to limit before failing.
	 *
	 * @param targetMoment {Object} UTC moment
	 */
	function sendNearestTo(targetMoment){

		if( limit && Math.abs( moment.utc(time).diff(targetMoment, 'days'))  >= limit) {
			if(!searchForwards){
				searchForwards = true;
				sendNearestTo(moment(targetMoment).add(limit, 'days'));
				return;
			}
			else {
				return next(new Error('No data within searchLimit'));
			}
		}

		var stamp = moment(targetMoment).format('YYYYMMDD') + roundHours(moment(targetMoment).hour(), 6);
		var fileName = __dirname +"/json-data/"+ stamp +".json";

		res.setHeader('Content-Type', 'application/json');
		res.sendFile(fileName, {}, function (err) {
			if(err) {
				var nextTarget = searchForwards ? moment(targetMoment).add(6, 'hours') : moment(targetMoment).subtract(6, 'hours');
				sendNearestTo(nextTarget);
			}
		});
	}

	if(time && moment(time).isValid()){
		sendNearestTo(moment.utc(time));
	}
	else {
		return next(new Error('Invalid params, expecting: timeIso=ISO_TIME_STRING'));
	}

});

/**
 *
 * Ping for new data every 15 mins
 *
 */
setInterval(function(){
	run(moment.utc());
	run_wx(moment.utc());
}, 900000);

/**
 *
 * @param targetMoment {Object} moment to check for new data
 */
function run(targetMoment){
    console.log("Get WIND");
    /* get wind data from noaa */
	getWindGribData(targetMoment).then(function(response){
		if(response.stamp){
			convertWindGribToJson(response.stamp, response.targetMoment);
		}
	});
}

function run_wx(targetMoment){
    console.log("Get WX");
    /* get misc weather data */
	getWxGribData(targetMoment).then(function(response){
		if(response.stamp){
			convertWxGribToJson(response.stamp, response.targetMoment);
		}
	});
}

/**
 *
 * Finds and returns the latest 6 hourly wind GRIB2 data from NOAAA
 *
 * @returns {*|promise}
 */
function getWindGribData(targetMoment){

	var deferred = Q.defer();

	function runQuery(targetMoment){

        // only go 2 weeks deep
		if (moment.utc().diff(targetMoment, 'days') > 30){
	        console.log('hit limit, harvest complete or there is a big gap in data..');
            return;
        }

		var stamp = moment(targetMoment).format('YYYYMMDD') + roundHours(moment(targetMoment).hour(), 6);
    	var urlstamp = stamp.slice(0,8)+'/'+stamp.slice(8,10)+'/atmos';

		request.get({
			url: baseDir,
	        qs: {
	          file: 'gfs.t' + roundHours(moment(targetMoment).hour(), 6) + 'z.pgrb2.1p00.f000',
	          lev_10_m_above_ground: 'on',
				lev_surface: 'on',
                lev_mean_sea_level:'on',
				var_TMP: 'on',
				var_UGRD: 'on',
				var_VGRD: 'on', 
                var_PRMSL: 'on',
				leftlon: 0,
				rightlon: 360,
				toplat: 90,
				bottomlat: -90,
	          dir: '/gfs.' + urlstamp,
	        },

		}).on('error', function(err){
			// console.log(err);
			runQuery(moment(targetMoment).subtract(6, 'hours'));

		}).on('response', function(response) {

			console.log('response '+response.statusCode + ' | '+stamp);

			if(response.statusCode != 200){
				runQuery(moment(targetMoment).subtract(6, 'hours'));
			}

			else {
				// don't rewrite stamps
				if(!checkPath('json-data/'+ stamp +'.json', false)) {

					console.log('piping ' + stamp);

					// mk sure we've got somewhere to put output
					checkPath('grib-data', true);

					// pipe the file, resolve the valid time stamp
					var file = fs.createWriteStream("grib-data/"+stamp+".f000");
					response.pipe(file);
					file.on('finish', function() {
						file.close();
						deferred.resolve({stamp: stamp, targetMoment: targetMoment});
					});

				}
				else {
					console.log('already have '+ stamp +', not looking further');
					deferred.resolve({stamp: false, targetMoment: false});
				}
			}
		});

	}

	runQuery(targetMoment);
	return deferred.promise;
}

function convertWindGribToJson(stamp, targetMoment){

	// mk sure we've got somewhere to put output
	checkPath('json-data', true);

	var exec = require('child_process').exec, child;

	child = exec('converter/bin/grib2json --data --output json-data/'+stamp+'.json --names --compact grib-data/'+stamp+'.f000',
		{maxBuffer: 500*1024},
		function (error, stdout, stderr){

			if(error){
				console.log('exec error: ' + error);
			}

			else {
				console.log("converted..");

				// don't keep raw grib data
				exec('rm grib-data/*');

				// if we don't have older stamp, try and harvest one
				var prevMoment = moment(targetMoment).subtract(6, 'hours');
				var prevStamp = prevMoment.format('YYYYMMDD') + roundHours(prevMoment.hour(), 6);

				if(!checkPath('json-data/'+ prevStamp +'.json', false)){

					console.log("attempting to harvest older wind data "+ stamp);
					run(prevMoment);
				}

				else {
					console.log('got older, no need to harvest wind further');
				}
			}
		});
}

/**
 *
 * Finds and returns the latest 6 hourly wx GRIB2 data from NOAAA
 *
 * @returns {*|promise}
 */
function getWxGribData(targetMoment){

	var deferred = Q.defer();

	function runQuery(targetMoment){

        // only go 2 weeks deep
		if (moment.utc().diff(targetMoment, 'days') > 30){
	        console.log('hit limit, harvest complete or there is a big gap in wx data..');
            return;
        }

		// var stamp = moment(targetMoment).format('YYYYMMDD') + roundHours(moment(targetMoment).hour(), 6);
		var stamp = moment(targetMoment).format('YYYYMMDD') + roundHours(moment(targetMoment).hour(), 6);
    	var urlstamp = stamp.slice(0,8)+'/'+stamp.slice(8,10)+'/atmos';

		request.get({
			url: baseDir,
			qs: {
				file: 'gfs.t'+ roundHours(moment(targetMoment).hour(), 6) +'z.pgrb2.1p00.f000',
				var_PRMSL: 'on',
				var_CWAT: 'on',
				var_PWAT: 'on',
				leftlon: 0,
				rightlon: 360,
				toplat: 90,
				bottomlat: -90,
				dir: '/gfs.'+urlstamp
			}

		}).on('error', function(err){
			// console.log(err);
			runQuery(moment(targetMoment).subtract(6, 'hours'));

		}).on('response', function(response) {

			console.log('response '+response.statusCode + ' | '+stamp);

			if(response.statusCode != 200){
				runQuery(moment(targetMoment).subtract(6, 'hours'));
			}

			else {
				// don't rewrite stamps
				if(!checkPath('json-wx-data/'+ stamp +'.json', false)) {

					console.log('wx piping ' + stamp);

					// mk sure we've got somewhere to put output
					checkPath('grib-wx-data', true);

					// pipe the file, resolve the valid time stamp
					var file = fs.createWriteStream("grib-wx-data/"+stamp+".f000");
					response.pipe(file);
					file.on('finish', function() {
						file.close();
						deferred.resolve({stamp: stamp, targetMoment: targetMoment});
					});

				}
				else {
					console.log('already have wx '+ stamp +', not looking further');
					deferred.resolve({stamp: false, targetMoment: false});
				}
			}
		});

	}

	runQuery(targetMoment);
	return deferred.promise;
}


function convertWxGribToJson(stamp, targetMoment){

	// mk sure we've got somewhere to put output
	checkPath('json-wx-data', true);

	var exec = require('child_process').exec, child;

	child = exec('converter/bin/grib2json --data --output json-wx-data/'+stamp+'.json --names --compact grib-wx-data/'+stamp+'.f000',
		{maxBuffer: 500*1024},
		function (error, stdout, stderr){

			if(error){
				console.log('exec error: ' + error);
			}

			else {
				console.log("converted..");

				// don't keep raw grib data
				exec('rm grib-wx-data/*');

				// if we don't have older stamp, try and harvest one
				var prevMoment = moment(targetMoment).subtract(6, 'hours');
				var prevStamp = prevMoment.format('YYYYMMDD') + roundHours(prevMoment.hour(), 6);

				if(!checkPath('json-wx-data/'+ prevStamp +'.json', false)){

					console.log("attempting to harvest older wx data "+ stamp);
					run_wx(prevMoment);
				}

				else {
					console.log('got older, no need to harvest wx further');
				}
			}
		});
}

/**
 *
 * Round hours to expected interval, e.g. we're currently using 6 hourly interval
 * i.e. 00 || 06 || 12 || 18
 *
 * @param hours
 * @param interval
 * @returns {String}
 */
function roundHours(hours, interval){
	if(interval > 0){
		var result = (Math.floor(hours / interval) * interval);
		return result < 10 ? '0' + result.toString() : result;
	}
}

/**
 * Sync check if path or file exists
 *
 * @param path {string}
 * @param mkdir {boolean} create dir if doesn't exist
 * @returns {boolean}
 */
function checkPath(path, mkdir) {
    try {
	    fs.statSync(path);
	    return true;

    } catch(e) {
        if(mkdir){
	        fs.mkdirSync(path);
        }
	    return false;
    }
}

// init harvest
run(moment.utc());
run_wx(moment.utc());
