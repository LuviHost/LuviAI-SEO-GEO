-- Add KOBIPRATIK to publish_targets.type ENUM (admin-only adapter, luvihost grubu içi)
ALTER TABLE `publish_targets`
  MODIFY COLUMN `type` ENUM(
    'WORDPRESS_REST',
    'WORDPRESS_XMLRPC',
    'FTP',
    'SFTP',
    'CPANEL_API',
    'GITHUB',
    'WEBFLOW',
    'SANITY',
    'CONTENTFUL',
    'GHOST',
    'STRAPI',
    'WHMCS_KB',
    'CUSTOM_PHP',
    'MARKDOWN_ZIP',
    'KOBIPRATIK'
  ) NOT NULL;
