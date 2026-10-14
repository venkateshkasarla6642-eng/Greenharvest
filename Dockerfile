FROM php:8.2-apache

# Fix Apache MPM conflict: disable event/worker, enable prefork (required for PHP)
RUN a2dismod mpm_event mpm_worker 2>/dev/null || true \
    && a2enmod mpm_prefork

# Install PostgreSQL PHP extensions
RUN apt-get update && apt-get install -y libpq-dev \
    && docker-php-ext-install pdo pdo_pgsql

# Enable Apache mod_rewrite
RUN a2enmod rewrite

# Set working directory
WORKDIR /var/www/html

# Copy all project files to Apache web root
COPY . /var/www/html/

# Set appropriate directory permissions
RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html \
    && chmod -R 777 /var/www/html/uploads 2>/dev/null || true

# Expose Apache port
EXPOSE 80

# Start Apache server
CMD ["apache2-foreground"]
