var JiraApi = require('jira').JiraApi;
var GitHubApi = require('github');
//var util = require('util');
var request = require('request').defaults({ encoding: null });
var fs = require('fs');
var imported = require('./imported.json');
var azure = require('azure-storage');
var stream = require('stream');

// The GitHub API handles concurrent inserts really badly
// Guess they are using optimistic locking without retry, or something like that
// Serializing requests fixes the issue
var https = require('https');
https.globalAgent.maxSockets = 1;

var config = require('./config.live');

var container = config.azureStorage.container;

var blobSvc = azure.createBlobService(config.azureStorage.account, config.azureStorage.accessKey);

var jira = new JiraApi(config.jira.proto, config.jira.host, config.jira.port, config.jira.user, config.jira.password, '2');
var github = new GitHubApi({ version: "3.0.0" });
github.authenticate({
	type: "basic",
	username: config.github.user,
	password: config.github.password
});

var ignoredStatuses = [
	"resolved",
	"cancelled",
	"closed",
	"golive"
];

importIssues();

function importIssues() {
	jira.searchJira(config.jira.jql,
		{
			maxResults: 1000,
			fields: ['summary', 'description', 'priority', 'components', 'issuetype', 'reporter', 'key', 'comment', 'attachment', 'status', 'resolution']
		}, function (error, result) {

			processIssues(result.issues);

		});
}

function processIssues(issues) {

	issues.forEach(function (issue) {

		let issueName = issue.key + " - " + issue.fields.summary;

		let status = issue.fields.status.name.toLowerCase();
		let alreadyImported = imported.imported.indexOf(issue.key) >= 0;

		if (ignoredStatuses.indexOf(status) < 0) {

			if (!alreadyImported) {

				try {
					let labels = [];

					switch (issue.fields.priority.name) {
						case 'Showstopper':
							labels.push("priority:showstopper");
							break;
						case 'Critical':
							labels.push("priority:critical");
							break;
						case 'High':
							labels.push("priority:high");
							break;
						case 'Medium':
							labels.push("priority:medium");
							break;
						case 'Low':
							labels.push("priority:low");
							break;
						case 'Lowest':
							labels.push("priority:low");
							break;
					}

					issue.fields.components.forEach(function (component) {
						switch (component.name) {
							case 'API':
								labels.push('comp:api');
								break;
							case 'Back end general':
								labels.push('comp:backend');
								break;
							case 'Build process':
								labels.push('comp:build-process');
								break;
							case 'Datasource: S+':
								labels.push('comp:datasource-syllabus');
								break;
							case 'Documentation':
								labels.push('comp:documentation');
								break;
							case 'Front end / GWT':
								labels.push('comp:gwt');
								break;
							case 'Help':
								labels.push('comp:help');
								break;
							case 'Mobile':
								labels.push('comp:mobile');
								break;
						}
					});

					switch (issue.fields.issuetype.name) {
						case 'Bug':
							labels.push('type:bug');
							break;
						case 'Improvement':
							labels.push('type:enhancement');
							break;
						case 'New Feature':
							labels.push('type:feature');
							break;
						case 'Task':
							labels.push('type:task');
							break;
						case 'Epic':
							labels.push('type:epic');
							break;
						case 'Story':
							labels.push('type:story');
							break;
					}

					labels.push("jira");

					uploadAttachments(issue, function (attachments) {

						console.log("Importing issue: " + issueName)

						github.issues.create({
							owner: config.github.repouser,
							repo: config.github.reponame,
							title: issue.key + " - " + issue.fields.summary,
							body: updateImageReferences(issue.fields.description, attachments),
							labels: labels
						}, function (err, res) {
							if (err)
								console.log("Error creating issue: " + issue.fields.summary + ". Error: " + err + ", Res: " + res);
							else {
								console.log("Created issue: " + issue.fields.summary + " - #" + res.number);

								addComments(issue, res.number, attachments, function () {

									imported.imported.push(issue.key);

									fs.writeFile('./imported.json', JSON.stringify(imported), function (err) {
										if (err) return console.log(err);
									});

									console.log("Issue import completed: '" + issueName + "' imported to #" + res.number);
								});
							}
						});

					});
				}
				catch (e) {
					console.log("Error: " + e);
				}

				//console.log(util.inspect(issue, false, null));
			}
			else
				console.log("Skipping (already imported):" + issueName)
		}
		else
			console.log("Skipping (resolved):" + issueName)
	})
}

function updateImageReferences(text, attachments) {

	if (!text)
		return null;

	var regex = "!(.*)!";
	var result = text.match(regex);

	if (!result)
		return text;

	for (var i = 0; i < result.length; i++) {
		var fileName = result[i + 1].split("|")[0];

		var attachment = attachments.find((att) => { return att.attachment.filename == fileName; });

		if (attachment) {
			var link = attachment.uploadedLink;

			text = text.replace(result[i], "![image](" + encodeURI(link) + ")");
		}

		i = i + 2;
	}

	return text;
}

function addComments(issue, gitIssue, attachments, callback) {

	let commentsCreated = 0;
	let comments = undefined;

	if (issue.fields.comment) {
		if (issue.fields.comment.comments)
			comments = issue.fields.comment.comments;
		else {
			comments = [];
			comments.push(issue.fields.comment);
		}
	}

	if (comments) {


		github.issues.createComment({
			owner: config.github.repouser,
			repo: config.github.reponame,
			number: gitIssue,
			body: getAttachmentsComment(attachments)
		}, function (err, res) {
			if (err)
				console.log("Error creating comment: " + comment.body + ". Error: " + err + ", Res: " + res);
			else
				console.log("Created comment: " + res.id);

			comments.forEach(function (comment) {

				github.issues.createComment({
					owner: config.github.repouser,
					repo: config.github.reponame,
					number: gitIssue,
					body: updateImageReferences(comment.body, attachments)
				}, function (err, res) {
					if (err)
						console.log("Error creating comment: " + comment.body + ". Error: " + err + ", Res: " + res);
					else
						console.log("Created comment: " + res.id);

					commentsCreated = completeComment(comments, commentsCreated, callback);
				});

			});

			if (comments.length == 0)
				commentsCreated = completeComment(comments, commentsCreated, callback);
		});


	}
	else
		commentsCreated = completeComment(comments, commentsCreated, callback);

}

function getAttachmentsComment(attachments) {

	let comment = "*Attachments*\n";
	comment += "-----------\n\n";

	attachments.forEach(attachment => {
		comment += "[" + attachment.attachment.filename + "](" + encodeURI(attachment.uploadedLink) + ")" + "\n"
	});

	return comment;
}

function completeComment(comments, commentsCreated, callback) {

	commentsCreated++;

	if (commentsCreated >= comments.length) {
		if (callback)
			callback();
	}


	return commentsCreated;
}


function uploadAttachments(issue, callback) {

	let uploadedAttachments = [];

	if (issue.fields.attachment) {

		issue.fields.attachment.forEach(function (att) {

			request.get(att.content, { headers: { Authorization: 'Basic ' + config.jira.base64UserPassowrd  } }, function (error, response, body) {
				if (!error && response.statusCode == 200) {

					let fileBuffer = new Buffer(body);
					var bufferStream = new stream.PassThrough();
					bufferStream.end(fileBuffer);

					blobSvc.createBlockBlobFromStream(container, att.filename, bufferStream, fileBuffer.length, { contentType: att.mimeType, contentTypeHeader: att.mimeType }, function (error, result, response) {

						let link = undefined;

						if (error) {
							console.log("Error uploading file: " + att.content + ". Error: " + error);
						}
						else {
							link = "https://" + config.azureStorage.account  + ".blob.core.windows.net/" + container + "/" + att.filename;
						}

						if (!link)
							link = "image not uploaded"

						console.log("Uploaded file: " + link + " from attachment " + att.content);

						blobSvc.setBlobProperties(container, att.filename, { contentType: att.mimeType }, function (error, result, response) {
							if (error)
								console.log(error);
						});

						completeAttachment(issue, att, link, uploadedAttachments, callback);
					});


				}
				else {
					console.log("Error uploading image: " + att.content + ". Error: " + error);
				}
			});

		});

		if (issue.fields.attachment.length == 0)
			callback(uploadedAttachments);
	}
	else
		callback(uploadedAttachments);
}

function completeAttachment(issue, attachment, uploadedLink, uploadedAttachments, callback) {

	uploadedAttachments.push({
		attachment,
		uploadedLink
	});

	if (uploadedAttachments.length >= issue.fields.attachment.length) {
		if (callback)
			callback(uploadedAttachments);
	}

}