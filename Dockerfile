FROM php:8.2-apache

# Fix Apache MPM conflict: disable event/worker, enable prefork (required for PHP)
RUN a2dismod mpm_event mpm_worker 2>/dev/null || true \
    && a2enmod mpm_prefork

# Install PostgreSQL PHP extensions and OPcache for maximum execution speed
RUN apt-get update && apt-get install -y libpq-dev \
    && docker-php-ext-install pdo pdo_pgsql opcache \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Configure OPcache for production speed
RUN { \
        echo 'opcache.enable=1'; \
        echo 'opcache.memory_consumption=128'; \
        echo 'opcache.interned_strings_buffer=8'; \
        echo 'opcache.max_accelerated_files=10000'; \
        echo 'opcache.revalidate_freq=2'; \
        echo 'opcache.save_comments=1'; \
    } > /usr/local/etc/php/conf.d/opcache-recommended.ini

# Enable Apache modules: rewrite, deflate (gzip compression), headers, expires
RUN a2enmod rewrite deflate headers expires

# Pass container environment variables to PHP under Apache
RUN echo 'PassEnv DATABASE_URL DB_HOST DB_USER DB_PASS DB_NAME DB_PORT GH_PAY_MODE GH_LIVE_PROVIDER GH_LIVE_KEY_ID GH_LIVE_KEY_SECRET GH_WEBHOOK_SECRET RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_KEY RAZORPAY_SECRET RZP_KEY_ID RZP_KEY_SECRET CASHFREE_APP_ID CASHFREE_SECRET_KEY CASHFREE_WEBHOOK_SECRET CF_APP_ID CF_SECRET_KEY CASHFREE_CLIENT_ID CASHFREE_CLIENT_SECRET GH_CASHFREE_APP_ID GH_CASHFREE_SECRET_KEY' > /etc/apache2/conf-available/render-env.conf \
    && a2enconf render-env

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
