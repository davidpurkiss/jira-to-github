var config = {};
config.jira = {};
config.github = {};
config.azureStorage = {};

config.jira.proto = 'https';
config.jira.host = 'jira-url/host';
config.jira.port = 443;
config.jira.user = 'jira-user';
config.jira.password = 'jira-password';
config.jira.jql = 'project = jira-project-key AND resolution = Unresolved';
config.jira.base64UserPassowrd = 'base64(jira-user:jira-password)';

config.github.user = 'github-user'
config.github.password = 'github-password'
config.github.repouser = 'repo-user/org'
config.github.reponame = 'repo-name'

config.azureStorage.account = "storage-account-name";
config.azureStorage.accessKey = 'storage-access-key';
config.azureStorage.container = "storage-container-name";

module.exports = config;